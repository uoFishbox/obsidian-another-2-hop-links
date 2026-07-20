import type {
	VirtualizedItemVisibility,
	VirtualizedItemVisibilityState,
} from "../types";
import type { CardPreviewSlotState } from "features/preview/ui/cardPreviewSnapshot";

/**
 * Props passed to flat virtual list item render snippets.
 */
export interface VirtualListItemRenderArgs<T> {
	item: T;
	index: number;
	observerRoot: HTMLElement | null;
	readonly visibility?: VirtualizedItemVisibility;
	readonly visibilityState?: VirtualizedItemVisibilityState;
	rowIndex: number;
	activationCandidateId: string;
	readonly previewState?: CardPreviewSlotState;
}

/**
 * Props passed to sectioned virtual list item render snippets.
 */
export interface SectionedVirtualListItemRenderArgs<
	T,
	G,
> extends VirtualListItemRenderArgs<T> {
	section: G;
}
