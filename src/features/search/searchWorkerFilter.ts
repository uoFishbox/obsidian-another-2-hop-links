import type {
	SearchWorkerMatchScope,
	SearchWorkerDatasetSnapshot,
	SearchWorkerFileContentSnapshot,
	SearchWorkerMatchedItem,
	SearchWorkerItemSnapshot,
} from "./searchWorkerTypes";
import { getSearchQueryTerms } from "./searchQueryTerms";
import { yieldToMainThreadIdleAware } from "core/indexing/timeSlicing";

export interface SearchWorkerFilterTimeSlicedOptions {
	dataset: SearchWorkerDatasetSnapshot;
	query: string;
	matchScope?: SearchWorkerMatchScope;
	cachedContentByPath?: ReadonlyMap<string, string>;
	onMatch: (item: SearchWorkerMatchedItem) => void;
	isCancelled?: () => boolean;
	yieldToMainThread?: () => Promise<void>;
	chunkSize?: number;
	yieldIntervalMs?: number;
}

export function filterSearchWorkerDataset(
	dataset: SearchWorkerDatasetSnapshot,
	query: string,
	matchScope: SearchWorkerMatchScope = "title-and-content",
	cachedContentByPath?: ReadonlyMap<string, string>,
): string[] {
	return filterSearchWorkerDatasetWithMatchDetails(
		dataset,
		query,
		matchScope,
		cachedContentByPath,
	).map((item) => item.key);
}

export function filterSearchWorkerDatasetWithMatchDetails(
	dataset: SearchWorkerDatasetSnapshot,
	query: string,
	matchScope: SearchWorkerMatchScope = "title-and-content",
	cachedContentByPath?: ReadonlyMap<string, string>,
): SearchWorkerMatchedItem[] {
	const queryTerms = getSearchQueryTerms(query);
	if (queryTerms.length === 0) {
		const matchedItems = new Array<SearchWorkerMatchedItem>(dataset.items.length);
		for (let index = 0; index < dataset.items.length; index += 1) {
			matchedItems[index] = createEmptyQueryMatch(dataset.items[index]);
		}
		return matchedItems;
	}

	const contentByPath =
		cachedContentByPath ?? buildSearchWorkerContentMap(dataset.fileContents);
	const maxLen = dataset.items.length;
	const matchedItems = new Array<SearchWorkerMatchedItem>(maxLen);
	let matchCount = 0;

	for (const item of dataset.items) {
		const matchedItem = getSearchWorkerItemMatch(
			item,
			queryTerms,
			matchScope,
			contentByPath,
		);
		if (matchedItem) {
			matchedItems[matchCount++] = matchedItem;
		}
	}

	matchedItems.length = matchCount;
	return matchedItems;
}

export async function filterSearchWorkerDatasetWithMatchDetailsTimeSliced(
	options: SearchWorkerFilterTimeSlicedOptions,
): Promise<void> {
	const {
		dataset,
		query,
		matchScope = "title-and-content",
		cachedContentByPath,
		onMatch,
		isCancelled = () => false,
		yieldToMainThread = () => yieldToMainThreadIdleAware({ maxDelayMs: 16 }),
		chunkSize = 128,
		yieldIntervalMs = 5,
	} = options;
	const queryTerms = getSearchQueryTerms(query);
	const contentByPath =
		queryTerms.length === 0
			? undefined
			: (cachedContentByPath ??
				buildSearchWorkerContentMap(dataset.fileContents));
	let lastYieldTime = performance.now();

	for (let index = 0; index < dataset.items.length; index += 1) {
		if (isCancelled()) {
			return;
		}

		const matchedItem =
			queryTerms.length === 0
				? createEmptyQueryMatch(dataset.items[index])
				: getSearchWorkerItemMatch(
						dataset.items[index],
						queryTerms,
						matchScope,
						contentByPath,
					);
		if (matchedItem) {
			onMatch(matchedItem);
		}

		if ((index + 1) % chunkSize !== 0) {
			continue;
		}

		const now = performance.now();
		if (now - lastYieldTime <= yieldIntervalMs) {
			continue;
		}

		await yieldToMainThread();
		lastYieldTime = performance.now();
	}
}

function createEmptyQueryMatch(
	item: SearchWorkerItemSnapshot,
): SearchWorkerMatchedItem {
	return {
		key: item.key,
		contentMatched: false,
	};
}

function getSearchWorkerItemMatch(
	item: SearchWorkerItemSnapshot,
	queryTerms: readonly string[],
	matchScope: SearchWorkerMatchScope,
	contentByPath: ReadonlyMap<string, string> | undefined,
): SearchWorkerMatchedItem | null {
	const fileContent = item.targetFilePath
		? contentByPath?.get(item.targetFilePath)
		: undefined;
	let contentMatched = false;

	for (const term of queryTerms) {
		const termTitleMatched = item.searchText.includes(term);
		const termContentMatched =
			matchScope === "title-and-content" &&
			(fileContent?.includes(term) ?? false);

		if (!termTitleMatched && !termContentMatched) {
			return null;
		}

		contentMatched = contentMatched || (!termTitleMatched && termContentMatched);
	}

	return {
		key: item.key,
		contentMatched,
	};
}

export function buildSearchWorkerContentMap(
	fileContents: SearchWorkerFileContentSnapshot[],
): Map<string, string> {
	const contentByPath = new Map<string, string>();
	for (const entry of fileContents) {
		contentByPath.set(entry.path, entry.content);
	}
	return contentByPath;
}
