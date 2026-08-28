import type { TFile, Vault } from "obsidian";
import { yieldToMainThreadIdleAware } from "indexing/timeSlicing";
import { getFileContent } from "card-preview/pipeline/previewContent";
import { getSearchQueryTerms } from "./searchQueryTerms";
import type {
	SearchItemSnapshot,
	SearchContentMatch,
	SearchMatchedItem,
	SearchMatchScope,
} from "./searchTypes";

const YIELD_CHECK_INTERVAL = 10;
const YIELD_BUDGET_MS = 5;
const YIELD_MAX_DELAY_MS = 100;
interface ContentTermMatches {
	readonly matches: readonly boolean[];
	readonly firstMatch: SearchContentMatch | null;
}

export interface StreamingSearchContentMatchUpdate {
	readonly path: string;
	readonly match: SearchContentMatch;
}

/** Append-only delta published at a cooperative yield boundary or completion. */
export interface StreamingSearchUpdate {
	readonly complete: boolean;
	readonly addedMatches: readonly SearchMatchedItem[];
	readonly addedContentMatches: readonly StreamingSearchContentMatchUpdate[];
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
	const contentMatchesByPath = new Map<string, ContentTermMatches>();
	const fileByPath = new Map(options.files.map((file) => [file.path, file]));
	const now = options.now ?? (() => performance.now());
	const yieldToMainThread =
		options.yieldToMainThread ??
		(() => yieldToMainThreadIdleAware({ maxDelayMs: YIELD_MAX_DELAY_MS }));
	let lastYieldTime = now();
	let processedCount = 0;
	let pendingMatches: SearchMatchedItem[] = [];
	let pendingContentMatches: StreamingSearchContentMatchUpdate[] = [];

	const publish = (complete: boolean): void => {
		if (options.isCancelled()) return;
		if (
			!complete &&
			pendingMatches.length === 0 &&
			pendingContentMatches.length === 0
		)
			return;

		const addedMatches = pendingMatches;
		const addedContentMatches = pendingContentMatches;
		pendingMatches = [];
		pendingContentMatches = [];
		options.onUpdate({
			complete,
			addedMatches,
			addedContentMatches,
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
			pendingMatches.push({
				key: item.key,
				contentMatched: false,
			});
		} else if (options.scope === "title-and-content" && item.targetFilePath) {
			const path = item.targetFilePath;
			let contentTermMatches = contentMatchesByPath.get(path);
			if (!contentTermMatches) {
				const file = fileByPath.get(path);
				if (file) {
					const content = await readContent(file, options.vault);
					if (options.isCancelled()) return;
					contentTermMatches = matchContentTerms(content, contentMatchers);
					contentMatchesByPath.set(path, contentTermMatches);
					if (contentTermMatches.firstMatch) {
						pendingContentMatches.push({
							path,
							match: contentTermMatches.firstMatch,
						});
					}
				}
			}

			if (
				contentTermMatches &&
				matchesAllTerms(titleMatches, contentTermMatches.matches)
			) {
				pendingMatches.push({
					key: item.key,
					contentMatched: hasRequiredContentMatch(
						titleMatches,
						contentTermMatches.matches,
					),
				});
			}
		}

		if (!(await checkpoint())) return;
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
	let firstMatch: SearchContentMatch | null = null;

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
