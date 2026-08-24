import { filterSearchWorkerDatasetWithMatchDetails } from "./searchWorkerFilter";
import type {
	MainToSearchWorkerMessage,
	SearchWorkerDatasetSnapshot,
	SearchWorkerToMainMessage,
} from "./searchWorkerTypes";

export {};

let currentDataset: SearchWorkerDatasetSnapshot = {
	datasetVersion: 0,
	items: [],
	fileContents: [],
};
let currentContentByPath = new Map<string, string>();

self.onmessage = (event: MessageEvent<MainToSearchWorkerMessage>): void => {
	const message = event.data;

	if (message.type === "sync-items") {
		currentDataset = {
			datasetVersion: message.datasetVersion,
			items: message.items,
			fileContents: [],
		};
		return;
	}

	if (message.type === "upsert-file-contents") {
		currentDataset.datasetVersion = message.datasetVersion;
		for (const entry of message.entries) {
			currentContentByPath.set(entry.path, entry.content);
		}
		return;
	}

	if (message.type === "remove-file-contents") {
		currentDataset.datasetVersion = message.datasetVersion;
		for (const path of message.paths) {
			currentContentByPath.delete(path);
		}
		return;
	}

	if (message.type === "filter") {
		const matchedItems = filterSearchWorkerDatasetWithMatchDetails(
			currentDataset,
			message.query,
			message.matchScope,
			currentContentByPath,
		);

		const response: SearchWorkerToMainMessage = {
			type: "filter-result",
			requestId: message.requestId,
			datasetVersion: message.datasetVersion,
			matchedItems,
		};

		postMessage(response);
		return;
	}

	currentDataset = {
		datasetVersion: 0,
		items: [],
		fileContents: [],
	};
	currentContentByPath = new Map();
	close();
};
