import { getSectionPaginationKey } from "ui/virtualization/pagination";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";

export interface TwoHopSectionSnapshot {
	readonly descriptor: TwoHopVirtualSectionDescriptor;
	readonly headerLogicalKey: string;
	readonly loadMoreLogicalKey: string;
	readonly visibleItems: readonly TwoHopVirtualListItem[];
	readonly visibleItemTitles: readonly string[];
	readonly visibleItemLogicalKeys: readonly string[];
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
	readonly resolveItemTitle: (item: TwoHopVirtualListItem) => string;
	/** Reuses materialized prefixes when the descriptor and revision are unchanged. */
	readonly previousSnapshot?: TwoHopSnapshot;
}

/**
 * Captures section sources without compiling a render object for every card.
 * Sparse sources retain only integer source indexes for their visible entries.
 */
export function createTwoHopSnapshot(
	params: CreateTwoHopSnapshotParams,
): TwoHopSnapshot {
	const sections: TwoHopSectionSnapshot[] = [];
	const previousSnapshot = params.previousSnapshot;
	const reusablePreviousSections =
		previousSnapshot && previousSnapshot.revision === params.revision
			? previousSnapshot.sections
			: [];
	const previousSections = new Map(
		reusablePreviousSections.map(
			(section) => [section.descriptor, section] as const,
		),
	);

	for (const descriptor of params.sections) {
		const paginationKey = getSectionPaginationKey(descriptor);
		const requestedVisibleCount =
			params.visibleCounts[paginationKey] ?? params.initialVisibleCount;
		const visibleCount = clampVisibleCount(descriptor, requestedVisibleCount);
		const previousSection = previousSections.get(descriptor);

		sections.push(
			createSectionSnapshot(
				descriptor,
				visibleCount,
				previousSection,
				params.resolveItemTitle,
			),
		);
	}

	return {
		revision: params.revision,
		sections,
	};
}

function createSectionSnapshot(
	descriptor: TwoHopVirtualSectionDescriptor,
	visibleCount: number,
	previousSection: TwoHopSectionSnapshot | undefined,
	resolveItemTitle: (item: TwoHopVirtualListItem) => string,
): TwoHopSectionSnapshot {
	if (previousSection?.visibleCount === visibleCount) {
		return previousSection;
	}

	const canExtendPrevious =
		previousSection !== undefined && previousSection.visibleCount < visibleCount;
	const visibleItems = canExtendPrevious ? [...previousSection.visibleItems] : [];
	const visibleItemTitles = canExtendPrevious
		? [...previousSection.visibleItemTitles]
		: [];
	const visibleItemLogicalKeys = canExtendPrevious
		? [...previousSection.visibleItemLogicalKeys]
		: [];
	const sourceIndexes = canExtendPrevious
		? Array.from(previousSection.visibleItemSourceIndexes)
		: [];
	const startSourceIndex = canExtendPrevious ? previousSection.visibleCount : 0;

	for (
		let sourceIndex = startSourceIndex;
		sourceIndex < visibleCount;
		sourceIndex += 1
	) {
		const item = descriptor.getItem(sourceIndex);
		if (!item) continue;
		visibleItems.push(item);
		visibleItemTitles.push(resolveItemTitle(item));
		visibleItemLogicalKeys.push(`item:${descriptor.sectionId}:${item.virtualKey}`);
		sourceIndexes.push(sourceIndex);
	}

	return {
		descriptor,
		headerLogicalKey: `header:${descriptor.sectionId}`,
		loadMoreLogicalKey: `load-more:${descriptor.sectionId}`,
		visibleItems,
		visibleItemTitles,
		visibleItemLogicalKeys,
		visibleCount,
		visibleItemCount: sourceIndexes.length,
		visibleItemSourceIndexes: Uint32Array.from(sourceIndexes),
		showLoadMore: visibleCount < descriptor.loadedCount,
	};
}

function clampVisibleCount(
	descriptor: TwoHopVirtualSectionDescriptor,
	count: number,
): number {
	if (!Number.isFinite(count)) return 0;
	return Math.min(descriptor.loadedCount, Math.max(0, Math.floor(count)));
}
