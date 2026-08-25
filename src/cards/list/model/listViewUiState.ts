/** Scroll state persisted by one flat virtual list view. */
export interface FlatListScrollState {
	localScrollTop: number;
	visibleCount: number;
}

/** Navigation state owned by a searchable flat-list view. */
export interface ListViewUiState {
	searchInputValue: string;
	scrollState?: FlatListScrollState;
}

/** Creates a validated list UI state from an Obsidian view-state payload. */
export function createListViewUiState(value?: unknown): ListViewUiState {
	const candidate = isRecord(value) ? value : undefined;
	const searchInputValue =
		typeof candidate?.searchInputValue === "string"
			? candidate.searchInputValue
			: "";
	const scrollState = parseFlatListScrollState(candidate?.scrollState);

	return scrollState ? { searchInputValue, scrollState } : { searchInputValue };
}

function parseFlatListScrollState(value: unknown): FlatListScrollState | undefined {
	if (!isRecord(value)) return undefined;

	const { localScrollTop, visibleCount } = value;
	if (
		typeof localScrollTop !== "number" ||
		!Number.isFinite(localScrollTop) ||
		typeof visibleCount !== "number" ||
		!Number.isFinite(visibleCount)
	) {
		return undefined;
	}

	return {
		localScrollTop: Math.max(0, localScrollTop),
		visibleCount: Math.max(0, Math.floor(visibleCount)),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
