import type { Snippet } from "svelte";
import type { CardPreviewRequest } from "card-preview/pipeline/cardPreviewRequest";
import type { ItemInteractionDescriptor } from "cards/interactions/interactionTypes";
import type { InteractionHandle } from "cards/interactions/interactionTypes";
import type { CardLayoutSettings } from "cards/layout/cardLayoutCssVars";
import type { SectionPaginationApplicationStore } from "cards/grid/pagination/sectionPagination";
import type { FlatListScrollState } from "cards/list/model/listViewUiState";

/** Props passed to flat virtual list item render snippets. */
export interface FlatCardGridItemRenderArgs<T> {
	item: T;
	index: number;
	scrollContainerEl: HTMLElement | null;
	rowIndex: number;
	activationCandidateId: string;
	readonly previewKey: string;
	readonly interactionHandle: InteractionHandle;
}

/** Application state consumed by flat-grid pagination and layout resolution. */
export interface FlatCardGridApplicationStore extends SectionPaginationApplicationStore {
	settings?: CardLayoutSettings;
}

/** Public rendering and behavior contract for one flat virtual card grid. */
export interface FlatCardGridProps<T> {
	items?: readonly T[];
	/**
	 * Stable unique identity for one logical list item. The value must remain
	 * unchanged when the item moves to another index.
	 */
	getItemId: (item: T, index: number) => string;
	/** Change this token when items are mutated in place. */
	itemsRevision?: unknown;
	/** Change this token when getItemId behavior changes without replacing it. */
	itemIdRevision?: unknown;
	header?: Snippet;
	item?: Snippet<[FlatCardGridItemRenderArgs<T>]>;
	empty?: Snippet;
	initialVisibleCount?: number;
	loadMoreIncrement?: number;
	sectionId?: string;
	applicationStore?: FlatCardGridApplicationStore;
	className?: string;
	paginationMode?: "button" | "infinite-scroll";
	infiniteScrollRootMargin?: string;
	/** Scroll position restored once after the first valid layout measurement. */
	initialScrollState?: FlatListScrollState;
	/** Persists published scroll and pagination measurements outside the grid. */
	onScrollStateChange?: (state: FlatListScrollState) => void;
	onMoveFocusAboveGrid?: () => boolean | Promise<boolean>;
	/** Resolves immutable preview input for the surface-owned slot controller. */
	resolveItemPreviewRequest?: (item: T, index: number) => CardPreviewRequest | null;
	/** Resolves the current item descriptor without card-owned effects. */
	resolveItemInteractionDescriptor?: (
		item: T,
		index: number,
	) => ItemInteractionDescriptor | null;
}
