import { getSectionPaginationKey } from "ui/components/common/virtual-list/pagination";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "./twoHopVirtualListModel";

export interface TwoHopSectionSnapshot {
	readonly descriptor: TwoHopVirtualSectionDescriptor;
	readonly items: readonly TwoHopVirtualListItem[];
	readonly visibleCount: number;
	readonly visibleItemCount: number;
	readonly visibleItemSourceIndexes: Uint32Array;
	readonly showLoadMore: boolean;
}

export interface TwoHopSnapshot {
	readonly revision: unknown;
	readonly sections: readonly TwoHopSectionSnapshot[];
}

export interface CreateTwoHopSnapshotParams {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly visibleCounts: Readonly<Record<string, number>>;
	readonly initialVisibleCount: number;
	readonly revision?: unknown;
}

/**
 * Captures section sources without compiling a render object for every card.
 * Sparse sources retain only integer source indexes for their visible entries.
 */
export function createTwoHopSnapshot(
	params: CreateTwoHopSnapshotParams,
): TwoHopSnapshot {
	const sections: TwoHopSectionSnapshot[] = [];

	for (const descriptor of params.sections) {
		const items = descriptor.getItems();
		const paginationKey = getSectionPaginationKey(descriptor);
		const requestedVisibleCount =
			params.visibleCounts[paginationKey] ?? params.initialVisibleCount;
		const visibleCount = clampVisibleCount(descriptor, requestedVisibleCount);
		const sourceIndexes: number[] = [];

		for (let sourceIndex = 0; sourceIndex < visibleCount; sourceIndex += 1) {
			if (items[sourceIndex]) {
				sourceIndexes.push(sourceIndex);
			}
		}

		sections.push({
			descriptor,
			items,
			visibleCount,
			visibleItemCount: sourceIndexes.length,
			visibleItemSourceIndexes: Uint32Array.from(sourceIndexes),
			showLoadMore: visibleCount < descriptor.loadedCount,
		});
	}

	return {
		revision: params.revision,
		sections,
	};
}

function clampVisibleCount(
	descriptor: TwoHopVirtualSectionDescriptor,
	count: number,
): number {
	if (!Number.isFinite(count)) return 0;
	return Math.min(descriptor.loadedCount, Math.max(0, Math.floor(count)));
}
