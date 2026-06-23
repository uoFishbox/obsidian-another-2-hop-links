import type {
	SearchWorkerMatchScope,
	SearchWorkerDatasetSnapshot,
	SearchWorkerFileContentSnapshot,
	SearchWorkerMatchedItem,
} from "./searchWorkerTypes";
import { getSearchQueryTerms } from "./searchQueryTerms";

export function filterSearchWorkerDataset(
	dataset: SearchWorkerDatasetSnapshot,
	query: string,
	matchScope: SearchWorkerMatchScope = "title-and-content",
	cachedContentByPath?: ReadonlyMap<string, string>,
): string[] {
	const matchedItems = filterSearchWorkerDatasetWithMatchDetails(
		dataset,
		query,
		matchScope,
		cachedContentByPath,
	);
	const matchedKeys = new Array<string>(matchedItems.length);
	for (let index = 0; index < matchedItems.length; index += 1) {
		matchedKeys[index] = matchedItems[index].key;
	}
	return matchedKeys;
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
			matchedItems[index] = {
				key: dataset.items[index].key,
				titleMatched: true,
				contentMatched: false,
			};
		}
		return matchedItems;
	}

	const contentByPath =
		cachedContentByPath ?? buildSearchWorkerContentMap(dataset.fileContents);
	const maxLen = dataset.items.length;
	const matchedItems = new Array<SearchWorkerMatchedItem>(maxLen);
	let matchCount = 0;

	for (const item of dataset.items) {
		const fileContent = item.targetFilePath
			? contentByPath.get(item.targetFilePath)
			: undefined;
		let titleMatched = true;
		let contentMatched = false;
		let matched = true;

		for (const term of queryTerms) {
			const termTitleMatched = item.searchText.includes(term);
			const termContentMatched =
				matchScope === "title-and-content" &&
				(fileContent?.includes(term) ?? false);

			if (!termTitleMatched && !termContentMatched) {
				matched = false;
				break;
			}

			titleMatched = titleMatched && termTitleMatched;
			contentMatched =
				contentMatched || (!termTitleMatched && termContentMatched);
		}

		if (matched) {
			matchedItems[matchCount++] = {
				key: item.key,
				titleMatched,
				contentMatched,
			};
		}
	}

	matchedItems.length = matchCount;
	return matchedItems;
}

export function buildSearchWorkerContentMap(
	fileContents: SearchWorkerFileContentSnapshot[],
): Map<string, string> {
	const contentByPath = new Map<string, string>();
	for (const entry of fileContents) {
		contentByPath.set(entry.path, entry.content.toLowerCase());
	}
	return contentByPath;
}
