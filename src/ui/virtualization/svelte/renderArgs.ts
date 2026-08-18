/**
 * Props passed to flat virtual list item render snippets.
 */
export interface VirtualListItemRenderArgs<T> {
	item: T;
	index: number;
	observerRoot: HTMLElement | null;
	rowIndex: number;
	activationCandidateId: string;
	readonly previewKey: string;
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
