// @ts-expect-error esbuild-plugin-inline-worker provides this default factory at bundle time.
import createSearchFilterWorker from "./searchFilter.worker";
import { filterSearchWorkerDatasetWithMatchDetails } from "./searchWorkerFilter";
import type {
	SearchWorkerFilterRequest,
	SearchWorkerToMainMessage,
	MainToSearchWorkerMessage,
	SearchWorkerItemsSnapshot,
	SearchWorkerFileContentsUpsert,
	SearchWorkerFileContentsRemoval,
	SearchWorkerDatasetSnapshot,
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
	let worker: Worker | null = null;
	let latestItems: SearchWorkerItemsSnapshot = {
		datasetVersion: 0,
		items: [],
	};
	let latestDatasetVersion = 0;

	try {
		if (typeof Worker !== "undefined") {
			const nextWorker = createSearchFilterWorker();
			nextWorker.onmessage = (
				event: MessageEvent<SearchWorkerToMainMessage>,
			) => {
				onMessage(event.data);
			};
			nextWorker.onerror = (event: ErrorEvent) => {
				onMessage({
					type: "error",
					message: event.message || "Search worker failed.",
				});
			};
			worker = nextWorker;
		}
	} catch {
		worker = null;
	}
	const latestContentByPath = worker ? null : new Map<string, string>();

	return {
		syncItems(snapshot: SearchWorkerItemsSnapshot): void {
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
			latestDatasetVersion = update.datasetVersion;
			if (latestContentByPath) {
				for (const entry of update.entries) {
					latestContentByPath.set(
						entry.path,
						entry.content.toLowerCase(),
					);
				}
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
			latestDatasetVersion = update.datasetVersion;
			if (latestContentByPath) {
				for (const path of update.paths) {
					latestContentByPath.delete(path);
				}
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
			if (!worker) {
				const snapshot: SearchWorkerDatasetSnapshot = {
					datasetVersion: latestDatasetVersion,
					items: latestItems.items,
					fileContents: [],
				};
				queueMicrotask(() => {
					const matchedItems =
						filterSearchWorkerDatasetWithMatchDetails(
							snapshot,
							request.query,
							request.matchScope,
							latestContentByPath ?? undefined,
						);
					onMessage({
						type: "filter-result",
						requestId: request.requestId,
						datasetVersion: request.datasetVersion,
						matchedItems,
					});
				});
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
			if (!worker) {
				return;
			}

			try {
				worker.postMessage({ type: "dispose" });
			} catch {
				// Worker 側の終了処理はベストエフォートで十分
			}
			worker.terminate();
			worker = null;
		},
	};
}
