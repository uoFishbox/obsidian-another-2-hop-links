import type { TwoHopLogicalCardCounts } from "features/two-hop/ui/twoHopRowModel";

const cardCountsByRoot = new WeakMap<HTMLElement, TwoHopLogicalCardCounts>();

/** Publishes the logical card counts for a mounted two-hop virtual surface. */
export function publishTwoHopCardCounts(
	root: HTMLElement,
	counts: TwoHopLogicalCardCounts,
): void {
	if (process.env.NODE_ENV === "production") return;

	cardCountsByRoot.set(
		root,
		Object.freeze({
			header: counts.header,
			item: counts.item,
			loadMore: counts.loadMore,
			total: counts.total,
		}),
	);
}

/** Returns the last logical card counts published for a two-hop surface. */
export function getTwoHopCardCounts(root: HTMLElement): TwoHopLogicalCardCounts | null {
	return cardCountsByRoot.get(root) ?? null;
}
