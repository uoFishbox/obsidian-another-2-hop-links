// @ts-expect-error esbuild-plugin-inline-worker provides this default factory at bundle time.
import createSearchFilterWorker from "./searchFilter.worker";
import { filterSearchWorkerDatasetWithMatchDetailsTimeSliced } from "./searchWorkerFilter";
import type {
	SearchWorkerFilterRequest,
	SearchWorkerToMainMessage,
	MainToSearchWorkerMessage,
	SearchWorkerItemsSnapshot,
	SearchWorkerFileContentsUpsert,
	SearchWorkerFileContentsRemoval,
	SearchWorkerDatasetSnapshot,
	SearchWorkerMatchedItem,
} from "./searchWorkerTypes";

export interface SearchWorkerClient {
	syncItems(snapshot: SearchWorkerItemsSnapshot): void;
	upsertFileContents(update: SearchWorkerFileContentsUpsert): void;
	removeFileContents(update: SearchWorkerFileContentsRemoval): void;
	filter(request: SearchWorkerFilterRequest): void;
	terminate(): void;
}

type WorkerMessageHandler = (message: SearchWorkerToMainMessage) => void;

export function createSearchWorkerClient(
	onMessage: WorkerMessageHandler,
): SearchWorkerClient {
	let initialized = false;
	let worker: Worker | null = null;
	let latestItems: SearchWorkerItemsSnapshot = {
		datasetVersion: 0,
		items: [],
	};
	let latestDatasetVersion = 0;
	let fallbackFilterSerial = 0;
	const latestContentByPath = new Map<string, string>();

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

	function ensureInitialized(): void {
		if (initialized) {
			return;
		}
		initialized = true;

		try {
			if (typeof Worker === "undefined") {
				return;
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
	}

	return {
		syncItems(snapshot: SearchWorkerItemsSnapshot): void {
			ensureInitialized();
			latestItems = snapshot;
			latestDatasetVersion = snapshot.datasetVersion;
			if (!worker) {
				return;
			}

			const message: MainToSearchWorkerMessage = {
				type: "sync-items",
				datasetVersion: snapshot.datasetVersion,
				items: snapshot.items,
			};
			worker.postMessage(message);
		},
		upsertFileContents(update: SearchWorkerFileContentsUpsert): void {
			ensureInitialized();
			latestDatasetVersion = update.datasetVersion;
			for (const entry of update.entries) {
				latestContentByPath.set(entry.path, entry.content.toLowerCase());
			}

			if (!worker) {
				return;
			}

			const message: MainToSearchWorkerMessage = {
				type: "upsert-file-contents",
				datasetVersion: update.datasetVersion,
				entries: update.entries,
			};
			worker.postMessage(message);
		},
		removeFileContents(update: SearchWorkerFileContentsRemoval): void {
			ensureInitialized();
			latestDatasetVersion = update.datasetVersion;
			for (const path of update.paths) {
				latestContentByPath.delete(path);
			}

			if (!worker) {
				return;
			}

			const message: MainToSearchWorkerMessage = {
				type: "remove-file-contents",
				datasetVersion: update.datasetVersion,
				paths: update.paths,
			};
			worker.postMessage(message);
		},
		filter(request: SearchWorkerFilterRequest): void {
			ensureInitialized();
			if (!worker) {
				const serial = ++fallbackFilterSerial;
				const matchedItems: SearchWorkerMatchedItem[] = [];

				void (async () => {
					const snapshot: SearchWorkerDatasetSnapshot = {
						datasetVersion: latestDatasetVersion,
						items: latestItems.items,
						fileContents: [],
					};
					await filterSearchWorkerDatasetWithMatchDetailsTimeSliced({
						dataset: snapshot,
						query: request.query,
						matchScope: request.matchScope,
						cachedContentByPath: latestContentByPath,
						onMatch: (item) => matchedItems.push(item),
						isCancelled: () => serial !== fallbackFilterSerial,
					});

					if (serial !== fallbackFilterSerial) {
						return;
					}

					onMessage({
						type: "filter-result",
						requestId: request.requestId,
						datasetVersion: request.datasetVersion,
						matchedItems,
					});
				})();
				return;
			}

			const message: MainToSearchWorkerMessage = {
				type: "filter",
				requestId: request.requestId,
				datasetVersion: request.datasetVersion,
				query: request.query,
				matchScope: request.matchScope,
			};
			worker.postMessage(message);
		},
		terminate(): void {
			fallbackFilterSerial += 1;
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
