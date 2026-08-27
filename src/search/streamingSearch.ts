import type { Pos, TFile, Vault } from "obsidian";
import { yieldToMainThreadIdleAware } from "indexing/timeSlicing";
import { getFileContent } from "preview/pipeline/previewContent";
import { getSearchQueryTerms } from "./searchQueryTerms";
import type {
	SearchItemSnapshot,
	SearchMatchedItem,
	SearchMatchesSnapshot,
	SearchMatchScope,
} from "./searchTypes";

const YIELD_CHECK_INTERVAL = 10;
const YIELD_BUDGET_MS = 5;
const YIELD_MAX_DELAY_MS = 100;
const PROGRESS_INTERVAL_MS = 16;

interface PendingContentItem {
	readonly item: SearchItemSnapshot;
	readonly titleMatches: readonly boolean[];
}

interface FirstTermMatch {
	readonly offset: number;
	readonly length: number;
}

interface ContentTermMatches {
	readonly matches: readonly boolean[];
	readonly firstMatch: FirstTermMatch | null;
}

export interface StreamingSearchUpdate extends SearchMatchesSnapshot {
	readonly complete: boolean;
}

export interface RunStreamingSearchOptions {
	readonly vault: Vault;
	readonly items: readonly SearchItemSnapshot[];
	readonly files: readonly TFile[];
	readonly query: string;
	readonly scope: SearchMatchScope;
	readonly isCancelled: () => boolean;
	readonly onUpdate: (update: StreamingSearchUpdate) => void;
	readonly yieldToMainThread?: () => Promise<void>;
	readonly now?: () => number;
}

/**
 * Searches unique files on demand and cooperatively yields using the same
 * short-budget strategy as Obsidian's core search.
 */
export async function runStreamingSearch(
	options: RunStreamingSearchOptions,
): Promise<void> {
	const terms = getSearchQueryTerms(options.query);
	const contentMatchers = terms.map(createCaseInsensitiveLiteralMatcher);
	const matchesByKey = new Map<string, SearchMatchedItem>();
	const firstContentMatchPositionByPath = new Map<string, Pos>();
	const pendingItemsByPath = new Map<string, PendingContentItem[]>();
	const now = options.now ?? (() => performance.now());
	const yieldToMainThread =
		options.yieldToMainThread ??
		(() => yieldToMainThreadIdleAware({ maxDelayMs: YIELD_MAX_DELAY_MS }));
	let lastYieldTime = now();
	let lastPublishTime = lastYieldTime;
	let publishedMatchCount = 0;
	let processedCount = 0;

	const publish = (complete: boolean): void => {
		if (options.isCancelled()) return;
		if (!complete && matchesByKey.size === publishedMatchCount) return;

		const currentTime = now();
		if (
			!complete &&
			publishedMatchCount > 0 &&
			currentTime - lastPublishTime < PROGRESS_INTERVAL_MS
		) {
			return;
		}

		publishedMatchCount = matchesByKey.size;
		lastPublishTime = currentTime;
		options.onUpdate({
			complete,
			matchesByKey: new Map(matchesByKey),
			firstContentMatchPositionByPath: new Map(firstContentMatchPositionByPath),
		});
	};

	const checkpoint = async (): Promise<boolean> => {
		processedCount += 1;
		if (options.isCancelled()) return false;
		if (processedCount % YIELD_CHECK_INTERVAL !== 0) return true;

		const currentTime = now();
		if (currentTime - lastYieldTime <= YIELD_BUDGET_MS) return true;

		publish(false);
		await yieldToMainThread();
		lastYieldTime = now();
		return !options.isCancelled();
	};

	for (const item of options.items) {
		if (options.isCancelled()) return;

		const titleMatches = terms.map((term) => item.searchText.includes(term));
		if (titleMatches.every(Boolean)) {
			matchesByKey.set(item.key, {
				key: item.key,
				contentMatched: false,
			});
			publish(false);
		} else if (options.scope === "title-and-content" && item.targetFilePath) {
			const pendingItems = pendingItemsByPath.get(item.targetFilePath);
			const pendingItem = { item, titleMatches };
			if (pendingItems) pendingItems.push(pendingItem);
			else pendingItemsByPath.set(item.targetFilePath, [pendingItem]);
		}

		if (!(await checkpoint())) return;
	}

	if (options.scope === "title-and-content" && pendingItemsByPath.size > 0) {
		const fileByPath = new Map<string, TFile>();
		for (const file of options.files) {
			if (pendingItemsByPath.has(file.path)) fileByPath.set(file.path, file);
		}

		for (const [path, pendingItems] of pendingItemsByPath) {
			if (options.isCancelled()) return;
			const file = fileByPath.get(path);
			if (!file) continue;

			const content = await readContent(file, options.vault);
			if (options.isCancelled()) return;
			const { matches: contentMatches, firstMatch } = matchContentTerms(
				content,
				contentMatchers,
			);
			if (firstMatch) {
				firstContentMatchPositionByPath.set(
					path,
					buildPosFromOffset(content, firstMatch.offset, firstMatch.length),
				);
			}

			for (const pending of pendingItems) {
				if (!matchesAllTerms(pending.titleMatches, contentMatches)) continue;
				matchesByKey.set(pending.item.key, {
					key: pending.item.key,
					contentMatched: hasRequiredContentMatch(
						pending.titleMatches,
						contentMatches,
					),
				});
			}

			publish(false);
			if (!(await checkpoint())) return;
		}
	}

	if (!options.isCancelled()) publish(true);
}

async function readContent(file: TFile, vault: Vault): Promise<string> {
	try {
		return await getFileContent(file, vault);
	} catch {
		return "";
	}
}

function createCaseInsensitiveLiteralMatcher(term: string): RegExp {
	return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function matchContentTerms(
	content: string,
	matchers: readonly RegExp[],
): ContentTermMatches {
	const matches: boolean[] = [];
	let firstMatch: FirstTermMatch | null = null;

	for (const matcher of matchers) {
		const match = matcher.exec(content);
		matches.push(match !== null);
		if (!match || (firstMatch && firstMatch.offset <= match.index)) continue;
		firstMatch = {
			offset: match.index,
			length: match[0].length,
		};
	}

	return { matches, firstMatch };
}

function matchesAllTerms(
	titleMatches: readonly boolean[],
	contentMatches: readonly boolean[],
): boolean {
	for (let index = 0; index < titleMatches.length; index += 1) {
		if (!titleMatches[index] && !contentMatches[index]) return false;
	}
	return true;
}

function hasRequiredContentMatch(
	titleMatches: readonly boolean[],
	contentMatches: readonly boolean[],
): boolean {
	for (let index = 0; index < titleMatches.length; index += 1) {
		if (!titleMatches[index] && contentMatches[index]) return true;
	}
	return false;
}

function countNewlinesUntil(content: string, endOffset: number): number {
	let lines = 0;
	for (let index = 0; index < endOffset; index += 1) {
		if (content.charCodeAt(index) === 10) lines += 1;
	}
	return lines;
}

function getLineStartOffset(content: string, offset: number): number {
	const newlineIndex = content.lastIndexOf("\n", Math.max(0, offset - 1));
	return newlineIndex === -1 ? 0 : newlineIndex + 1;
}

function buildPosFromOffset(content: string, startOffset: number, length: number): Pos {
	const endOffset = startOffset + Math.max(1, length);
	return {
		start: {
			line: countNewlinesUntil(content, startOffset),
			col: startOffset - getLineStartOffset(content, startOffset),
			offset: startOffset,
		},
		end: {
			line: countNewlinesUntil(content, endOffset),
			col: endOffset - getLineStartOffset(content, endOffset),
			offset: endOffset,
		},
	};
}
