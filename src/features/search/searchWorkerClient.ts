// @ts-expect-error esbuild-plugin-inline-worker provides this default factory at bundle time.
import createSearchFilterWorker from "./searchFilter.worker";
import type {
	SearchWorkerFilterRequest,
	SearchWorkerToMainMessage,
	MainToSearchWorkerMessage,
	SearchWorkerItemsSnapshot,
	SearchWorkerFileContentsUpsert,
	SearchWorkerFileContentsRemoval,
} from "./searchWorkerTypes";

export interface SearchWorkerClient {
	syncItems(snapshot: SearchWorkerItemsSnapshot): void;
	upsertFileContents(update: SearchWorkerFileContentsUpsert): void;
	removeFileContents(update: SearchWorkerFileContentsRemoval): void;
	filter(request: SearchWorkerFilterRequest): void;
	terminate(): void;
}

type WorkerMessageHandler = (message: SearchWorkerToMainMessage) => void;

const WORKER_UNAVAILABLE_MESSAGE = "Search worker is unavailable.";

export function createSearchWorkerClient(
	onMessage: WorkerMessageHandler,
): SearchWorkerClient {
	let initialized = false;
	let worker: Worker | null = null;

	function notifyWorkerUnavailable(): void {
		onMessage({
			type: "error",
			message: WORKER_UNAVAILABLE_MESSAGE,
		});
	}

	function disableWorker(failedWorker: Worker): boolean {
		if (worker !== failedWorker) {
			return false;
		}

		worker = null;
		failedWorker.onmessage = null;
		failedWorker.onerror = null;
		try {
			failedWorker.terminate();
		} catch {
			// A failed Worker may already be unavailable to the host runtime.
		}
		return true;
	}

	function ensureInitialized(): Worker | null {
		if (initialized) {
			return worker;
		}
		initialized = true;

		try {
			if (typeof Worker === "undefined") {
				return null;
			}

			const nextWorker = createSearchFilterWorker();
			nextWorker.onmessage = (event: MessageEvent<SearchWorkerToMainMessage>) => {
				onMessage(event.data);
			};
			nextWorker.onerror = (event: ErrorEvent) => {
				if (!disableWorker(nextWorker)) {
					return;
				}
				onMessage({
					type: "error",
					message: event.message || "Search worker failed.",
				});
			};
			worker = nextWorker;
		} catch {
			worker = null;
		}

		return worker;
	}

	function postMessage(message: MainToSearchWorkerMessage): boolean {
		const activeWorker = ensureInitialized();
		if (!activeWorker) {
			return false;
		}

		try {
			activeWorker.postMessage(message);
			return true;
		} catch {
			if (disableWorker(activeWorker)) {
				onMessage({
					type: "error",
					message: "Search worker failed.",
				});
			}
			return false;
		}
	}

	return {
		syncItems(snapshot: SearchWorkerItemsSnapshot): void {
			postMessage({
				type: "sync-items",
				datasetVersion: snapshot.datasetVersion,
				items: snapshot.items,
			});
		},
		upsertFileContents(update: SearchWorkerFileContentsUpsert): void {
			postMessage({
				type: "upsert-file-contents",
				datasetVersion: update.datasetVersion,
				entries: update.entries,
			});
		},
		removeFileContents(update: SearchWorkerFileContentsRemoval): void {
			postMessage({
				type: "remove-file-contents",
				datasetVersion: update.datasetVersion,
				paths: update.paths,
			});
		},
		filter(request: SearchWorkerFilterRequest): void {
			const activeWorker = ensureInitialized();
			if (!activeWorker) {
				notifyWorkerUnavailable();
				return;
			}

			postMessage({
				type: "filter",
				requestId: request.requestId,
				datasetVersion: request.datasetVersion,
				query: request.query,
				matchScope: request.matchScope,
			});
		},
		terminate(): void {
			if (!initialized || !worker) {
				return;
			}

			const activeWorker = worker;
			worker = null;
			try {
				activeWorker.postMessage({ type: "dispose" });
			} catch {
				// Worker 側の終了処理はベストエフォートで十分
			}
			activeWorker.onmessage = null;
			activeWorker.onerror = null;
			activeWorker.terminate();
		},
	};
}
