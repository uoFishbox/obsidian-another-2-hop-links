import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import { createSectionDataRevision } from "features/two-hop/ui/twoHopRevisions";

const EMPTY_HEADER_PROPS: ClickableHeaderExtraProps = {};
let nextSectionDataRevision = 1;

export interface CachedVirtualItemAccessors {
	readonly getItems: () => readonly TwoHopVirtualListItem[];
	readonly getItem: (index: number) => TwoHopVirtualListItem | undefined;
}

/**
 * Exposes an already materialized immutable publication through the descriptor
 * accessor contract.
 */
export function createEagerVirtualItemAccessors(
	items: readonly TwoHopVirtualListItem[],
): CachedVirtualItemAccessors {
	return {
		getItems: () => items,
		getItem: (index) => items[index],
	};
}

export function createDescriptor(
	section: TwoHopVirtualListSection,
	totalCount: number,
	getItems: () => readonly TwoHopVirtualListItem[],
	getItem: (index: number) => TwoHopVirtualListItem | undefined = (index) =>
		getItems()[index],
	headerProps: ClickableHeaderExtraProps = EMPTY_HEADER_PROPS,
): TwoHopVirtualSectionDescriptor {
	const immutableSection = Object.freeze(section);
	return Object.freeze({
		sourceRevision: createSectionDataRevision(nextSectionDataRevision++),
		section: immutableSection,
		sectionKey: immutableSection.sectionKey,
		title: immutableSection.title,
		sectionId: immutableSection.rawSectionId,
		totalCount,
		loadedCount: totalCount,
		getItems,
		getItem,
		headerProps,
	});
}

export function pruneInactiveEntries<T>(
	entries: Map<string, T>,
	activeIds: Set<string>,
): void {
	for (const key of entries.keys()) {
		if (!activeIds.has(key)) entries.delete(key);
	}
}
