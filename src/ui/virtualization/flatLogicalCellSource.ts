import {
	logicalCellKey,
	sourceKey,
	type LogicalCellKey,
	type SourceKey,
} from "./types";
import type { VirtualListLogicalCell } from "./logicalCell";

export interface FlatLogicalCellSource<T> {
	readonly revision: unknown;
	/**
	 * Stable while resident physical cells may safely keep their component
	 * bodies across ordinary viewport recycling.
	 */
	readonly bindingTopologyRevision: unknown;
	readonly cellCount: number;
	readonly hasHeader: boolean;
	readonly visibleCount: number;
	readonly showLoadMore: boolean;
	resolveCellAtIndex(index: number): VirtualListLogicalCell<T> | null;
	resolveLogicalCellKeyAtItemIndex(itemIndex: number): LogicalCellKey | null;
	resolveSourceKeyAtItemIndex(itemIndex: number): SourceKey | null;
}

interface ResolvedFlatItemIdentity {
	readonly logicalKey: LogicalCellKey;
	readonly sourceKey: SourceKey;
}

const encodeFlatLogicalKeyPart = (value: string): string => `${value.length}:${value}`;

/**
 * Builds the lazy logical-cell source for a flat grid.
 *
 * `getItemId` is the identity contract for the virtualized item. Its result must
 * be unique among items in this source and stable across reorder/filter updates.
 * Position is deliberately excluded from the logical key so a moved item keeps
 * the same virtual-cell and preview identity.
 */
export function createFlatLogicalCellSource<T>(params: {
	header: boolean;
	items: readonly T[];
	visibleCount: number;
	showLoadMore: boolean;
	getItemId: (item: T, index: number) => string;
	sectionId?: string;
	revision?: unknown;
	bindingTopologyRevision?: unknown;
}): FlatLogicalCellSource<T> {
	const keyPrefix = params.sectionId ?? "link-list";
	const encodedKeyPrefix = encodeFlatLogicalKeyPart(keyPrefix);
	const hasHeader = params.header;
	const visibleCount = Math.max(
		0,
		Math.min(params.items.length, Math.floor(params.visibleCount)),
	);
	const headerOffset = hasHeader ? 1 : 0;
	const loadMoreIndex = headerOffset + visibleCount;
	const cellCount = loadMoreIndex + (params.showLoadMore ? 1 : 0);
	const headerCell: VirtualListLogicalCell<T> | null = hasHeader
		? {
				kind: "header",
				key: logicalCellKey(`flat:${encodedKeyPrefix}:header`),
			}
		: null;
	const loadMoreCell: VirtualListLogicalCell<T> | null = params.showLoadMore
		? {
				kind: "load-more",
				key: logicalCellKey(`flat:${encodedKeyPrefix}:load-more`),
			}
		: null;
	const revision = params.revision ?? {
		data: params.items,
		itemId: params.getItemId,
		visibleCount,
		hasHeader,
		showLoadMore: params.showLoadMore,
		sectionId: params.sectionId,
	};
	const bindingTopologyRevision = params.bindingTopologyRevision ?? revision;
	const itemIdentityByIndex: Array<ResolvedFlatItemIdentity | undefined> = new Array(
		visibleCount,
	);
	const firstIndexByItemId =
		process.env.NODE_ENV === "production" ? undefined : new Map<string, number>();

	const resolveItemIdentity = (
		itemIndex: number,
	): ResolvedFlatItemIdentity | null => {
		if (itemIndex < 0 || itemIndex >= visibleCount) return null;
		const cached = itemIdentityByIndex[itemIndex];
		if (cached) return cached;

		const item = params.items[itemIndex];
		if (item === undefined) return null;
		const itemId = params.getItemId(item, itemIndex);
		const previousIndex = firstIndexByItemId?.get(itemId);
		if (previousIndex !== undefined && previousIndex !== itemIndex) {
			throw new TypeError(
				`Flat virtual-grid item id must be unique: ${JSON.stringify(itemId)} is used by indexes ${previousIndex} and ${itemIndex}.`,
			);
		}
		firstIndexByItemId?.set(itemId, itemIndex);

		const identity = {
			logicalKey: logicalCellKey(
				`flat:${encodedKeyPrefix}:item:${encodeFlatLogicalKeyPart(itemId)}`,
			),
			sourceKey: sourceKey(itemId),
		};
		itemIdentityByIndex[itemIndex] = identity;
		return identity;
	};

	return {
		revision,
		bindingTopologyRevision,
		cellCount,
		hasHeader,
		visibleCount,
		showLoadMore: params.showLoadMore,
		resolveLogicalCellKeyAtItemIndex(itemIndex) {
			return resolveItemIdentity(itemIndex)?.logicalKey ?? null;
		},
		resolveSourceKeyAtItemIndex(itemIndex) {
			return resolveItemIdentity(itemIndex)?.sourceKey ?? null;
		},
		resolveCellAtIndex(index) {
			if (index < 0 || index >= cellCount) return null;
			if (hasHeader && index === 0) return headerCell;
			if (params.showLoadMore && index === loadMoreIndex) return loadMoreCell;

			const itemIndex = index - headerOffset;
			if (itemIndex < 0 || itemIndex >= visibleCount) return null;
			const item = params.items[itemIndex];
			if (item === undefined) return null;
			const identity = resolveItemIdentity(itemIndex);
			if (!identity) return null;

			return {
				kind: "item",
				key: identity.logicalKey,
				sourceKey: identity.sourceKey,
				item,
				itemIndex,
			};
		},
	};
}
