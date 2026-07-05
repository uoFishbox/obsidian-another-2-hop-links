import { logicalCellKey, sourceKey } from "ui/components/common/virtual-list/types";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";
import type { TwoHopSectionPlan, TwoHopViewPlan } from "./types";
import {
	markTwoHopMaterializationChanged,
	markTwoHopSectionMaterialized,
	recordTwoHopCellFilled,
} from "./twoHopCellStore";
export function resolveInitialMaterializationCellCount(
	plan: TwoHopViewPlan,
	maxSectionCount: number | undefined,
): number {
	if (maxSectionCount === undefined) return 128;
	const sectionCount = Math.max(0, Math.floor(maxSectionCount));
	let cellCount = 0;
	for (
		let sectionIndex = 0;
		sectionIndex < Math.min(sectionCount, plan.sectionTable.sectionCount);
		sectionIndex += 1
	) {
		cellCount += plan.sectionTable.cellCountBySection[sectionIndex];
	}
	return cellCount;
}

function resolveTwoHopDescriptorItem(
	descriptor: SectionRenderDescriptor<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>,
	itemIndex: number,
	resolvedItems?: readonly TwoHopVirtualListItem[],
): TwoHopVirtualListItem | undefined {
	if (resolvedItems) return resolvedItems[itemIndex];
	if (descriptor.getItem) return descriptor.getItem(itemIndex);
	return descriptor.getItems()[itemIndex];
}

function createTwoHopLogicalCellAt(
	sectionPlan: TwoHopSectionPlan,
	cellIndex: number,
	resolvedItems?: readonly TwoHopVirtualListItem[],
): VirtualListLogicalCell<TwoHopVirtualListItem> | undefined {
	const { descriptor, visibleCount, showLoadMore, cellCount } = sectionPlan;

	if (cellIndex === 0) {
		return {
			kind: "header",
			key: logicalCellKey(`${sectionPlan.sectionIdPrefix}__header`),
		};
	}

	if (showLoadMore && cellIndex === cellCount - 1) {
		return {
			kind: "load-more",
			key: logicalCellKey(`${sectionPlan.sectionIdPrefix}__load-more`),
		};
	}

	const itemIndex = cellIndex - 1;
	if (itemIndex < 0 || itemIndex >= visibleCount) return undefined;

	const item = resolveTwoHopDescriptorItem(descriptor, itemIndex, resolvedItems);
	if (!item) return undefined;

	const sourceRawKey = `${sectionPlan.sectionIdPrefix}${item.virtualKey}`;
	return {
		kind: "item",
		key: logicalCellKey(`${sectionPlan.sectionIdPrefix}item:${itemIndex}`),
		sourceKey: sourceKey(sourceRawKey),
		item,
		itemIndex,
	};
}

function ensureTwoHopSectionCellMaterialized(
	plan: TwoHopViewPlan,
	sectionPlan: TwoHopSectionPlan,
	cellIndex: number,
	resolvedItems?: readonly TwoHopVirtualListItem[],
): boolean {
	const logicalCells =
		plan.cellStore.logicalCellsBySectionIndex[sectionPlan.sectionIndex];
	if (!logicalCells || logicalCells[cellIndex]) return false;
	const cell = createTwoHopLogicalCellAt(sectionPlan, cellIndex, resolvedItems);
	if (!cell) return false;
	logicalCells[cellIndex] = cell;
	return true;
}

/**
 * Materializes item cells for one section without changing its compiled layout.
 *
 * Batched plans rely on visible items being dense up to visibleCount. This is
 * the same invariant used by TwoHop section descriptors when reporting counts.
 */
export function materializeTwoHopSectionCells(
	plan: TwoHopViewPlan,
	sectionIndex: number,
	resolvedItems?: readonly TwoHopVirtualListItem[],
): boolean {
	const sectionPlan = plan.sections[sectionIndex];
	const cellStore = plan.cellStore;
	if (!sectionPlan || cellStore.materializedSectionByIndex[sectionIndex] !== 0) {
		return false;
	}
	let changed = false;
	for (let cellIndex = 0; cellIndex < sectionPlan.cellCount; cellIndex += 1) {
		changed =
			ensureTwoHopSectionCellMaterialized(
				plan,
				sectionPlan,
				cellIndex,
				resolvedItems,
			) || changed;
	}
	const materializedCellCount =
		cellStore.materializedCellCountBySection[sectionIndex];
	const remainingCells = Math.max(
		0,
		sectionPlan.cellCount - materializedCellCount,
	);
	cellStore.nextCellIndexBySection[sectionIndex] = sectionPlan.cellCount;
	cellStore.materializedCellCountBySection[sectionIndex] =
		sectionPlan.cellCount;
	cellStore.remainingUnmaterializedCellCount = Math.max(
		0,
		cellStore.remainingUnmaterializedCellCount - remainingCells,
	);
	markTwoHopSectionMaterialized(plan, sectionIndex);
	if (changed) {
		markTwoHopMaterializationChanged(plan);
	}
	return changed;
}

/**
 * Materializes the next cells in display order.
 */
export interface MaterializeNextTwoHopCellBatchOptions {
	readonly maxCellCount?: number;
	shouldContinue?(): boolean;
}

/**
 * Result of materializing the next cell batch.
 *
 * `affectedRowRange` is the inclusive-start, exclusive-end range of global
 * row indices that actually gained a newly materialized cell this call. It is
 * only meaningful when `changed` is true; callers that only need a boolean can
 * use `materializeNextTwoHopSectionBatch` instead.
 */
export interface MaterializeNextTwoHopCellBatchResult {
	readonly changed: boolean;
	readonly affectedRowRange: RowRange | null;
}

export function materializeNextTwoHopCellBatch(
	plan: TwoHopViewPlan,
	options: MaterializeNextTwoHopCellBatchOptions = {},
): MaterializeNextTwoHopCellBatchResult {
	const cellStore = plan.cellStore;
	let remainingCellBudget = Math.max(0, Math.floor(options.maxCellCount ?? 128));
	if (remainingCellBudget === 0 || cellStore.remainingUnmaterializedCellCount === 0) {
		return { changed: false, affectedRowRange: null };
	}
	// Rows aggregate `columns` cells each, so a section-local cell index maps to
	// row index `floor(sectionCellIndex / columns)`. Materialization walks
	// sections in display order and cells left-to-right, so newly materialized
	// cells always form a contiguous prefix; tracking the min/max global row
	// covers any cells spanning multiple sections.
	const columns = Math.max(1, plan.columns);
	let materialized = false;
	let minAffectedRowIndex = Infinity;
	let maxAffectedRowIndex = -Infinity;
	while (
		cellStore.nextUnmaterializedSectionIndex < plan.sections.length &&
		remainingCellBudget > 0
	) {
		if (options.shouldContinue && !options.shouldContinue()) break;
		const sectionIndex = cellStore.nextUnmaterializedSectionIndex;
		const sectionPlan = plan.sections[sectionIndex];
		if (!sectionPlan) {
			cellStore.nextUnmaterializedSectionIndex += 1;
			continue;
		}
		if (
			cellStore.materializedCellCountBySection[sectionIndex] >=
			sectionPlan.cellCount
		) {
			markTwoHopSectionMaterialized(plan, sectionIndex);
			cellStore.nextUnmaterializedSectionIndex += 1;
			continue;
		}
		// Fast-forward past cells that were already materialized out-of-band
		// (e.g. by synchronous scroll-driven materialization). They were
		// accounted for at their fill point, so re-walking them here would
		// double-count progress and waste the slice budget; skip them for free.
		const logicalCells = cellStore.logicalCellsBySectionIndex[sectionIndex];
		let nextCellIndex = cellStore.nextCellIndexBySection[sectionIndex];
		while (
			nextCellIndex < sectionPlan.cellCount &&
			logicalCells?.[nextCellIndex] !== undefined
		) {
			nextCellIndex += 1;
		}
		cellStore.nextCellIndexBySection[sectionIndex] = nextCellIndex;
		if (nextCellIndex >= sectionPlan.cellCount) {
			// Every remaining cell in this section is already materialized.
			if (
				cellStore.materializedCellCountBySection[sectionIndex] >=
				sectionPlan.cellCount
			) {
				markTwoHopSectionMaterialized(plan, sectionIndex);
			}
			cellStore.nextUnmaterializedSectionIndex += 1;
			continue;
		}
		const cellIndex = nextCellIndex;
		const newlyMaterialized = ensureTwoHopSectionCellMaterialized(
			plan,
			sectionPlan,
			cellIndex,
		);
		if (newlyMaterialized) {
			materialized = true;
			const sectionCompleted = recordTwoHopCellFilled(plan, sectionIndex);
			const rowIndexInSection = Math.floor(cellIndex / columns);
			const globalRowIndex = sectionPlan.firstRowIndex + rowIndexInSection;
			if (globalRowIndex < minAffectedRowIndex) {
				minAffectedRowIndex = globalRowIndex;
			}
			if (globalRowIndex > maxAffectedRowIndex) {
				maxAffectedRowIndex = globalRowIndex;
			}
			cellStore.nextCellIndexBySection[sectionIndex] = cellIndex + 1;
			remainingCellBudget -= 1;
			if (sectionCompleted) {
				markTwoHopSectionMaterialized(plan, sectionIndex);
				cellStore.nextUnmaterializedSectionIndex += 1;
			}
		} else {
			// The cell could not be created (e.g. no backing item). Treat it as
			// permanently resolved so background materialization can terminate
			// without revisiting it, without claiming it as materialized.
			cellStore.remainingUnmaterializedCellCount = Math.max(
				0,
				cellStore.remainingUnmaterializedCellCount - 1,
			);
			cellStore.nextCellIndexBySection[sectionIndex] = cellIndex + 1;
			remainingCellBudget -= 1;
		}
	}
	if (!materialized) {
		return { changed: false, affectedRowRange: null };
	}
	markTwoHopMaterializationChanged(plan);
	return {
		changed: true,
		affectedRowRange: {
			start: minAffectedRowIndex,
			end: maxAffectedRowIndex + 1,
		},
	};
}

export interface MaterializeNextTwoHopSectionBatchOptions extends MaterializeNextTwoHopCellBatchOptions {
	readonly maxSectionCount?: number;
}

/**
 * Convenience wrapper returning just whether anything changed. Retained as a
 * boolean for callers/tests that do not need the affected row range.
 */
export function materializeNextTwoHopSectionBatch(
	plan: TwoHopViewPlan,
	options: MaterializeNextTwoHopSectionBatchOptions = {},
): boolean {
	return materializeNextTwoHopCellBatch(plan, {
		maxCellCount:
			options.maxCellCount ??
			resolveInitialMaterializationCellCount(plan, options.maxSectionCount),
		shouldContinue: options.shouldContinue,
	}).changed;
}

/**
 * Returns whether a plan still has deferred section cells.
 */
export function hasUnmaterializedTwoHopSections(plan: TwoHopViewPlan): boolean {
	return plan.cellStore.remainingUnmaterializedCellCount > 0;
}

/**
 * Core cell-range materialization without revision bump.
 * Callers that batch multiple ranges should call this directly and bump
 * `cellStore.revision` once at the end.
 */
function materializeSectionCellRange(
	plan: TwoHopViewPlan,
	sectionIndex: number,
	startCellIndex: number,
	endCellIndex: number,
): boolean {
	if (plan.cellStore.materializedSectionByIndex[sectionIndex] !== 0) return false;
	const sectionPlan = plan.sections[sectionIndex];
	if (!sectionPlan) return false;
	let changed = false;
	let sectionCompleted = false;
	const start = Math.max(0, startCellIndex);
	const end = Math.min(sectionPlan.cellCount, endCellIndex);
	for (let cellIndex = start; cellIndex < end; cellIndex += 1) {
		if (!ensureTwoHopSectionCellMaterialized(plan, sectionPlan, cellIndex)) {
			continue;
		}
		changed = true;
		sectionCompleted =
			recordTwoHopCellFilled(plan, sectionIndex) || sectionCompleted;
	}
	if (sectionCompleted) {
		markTwoHopSectionMaterialized(plan, sectionIndex);
	}
	return changed;
}

export function ensureTwoHopSectionCellRangeMaterialized(
	plan: TwoHopViewPlan,
	sectionIndex: number,
	startCellIndex: number,
	endCellIndex: number,
): boolean {
	const changed = materializeSectionCellRange(
		plan,
		sectionIndex,
		startCellIndex,
		endCellIndex,
	);
	if (changed) {
		markTwoHopMaterializationChanged(plan);
	}
	return changed;
}

/**
 * Ensures every cell needed to render `rowRange` has been materialized.
 *
 * Reads cell ranges directly from `rowTable` typed arrays to avoid
 * allocating per-row resolved-row objects. Bumps `cellStore.revision`
 * once at the end instead of per row.
 */
export function ensureTwoHopMountedRangeMaterialized(
	plan: TwoHopViewPlan,
	range: RowRange,
): boolean {
	const table = plan.rowTable;
	const cellStore = plan.cellStore;
	const start = Math.max(0, range.start);
	const end = Math.min(table.rowCount, range.end);
	if (start >= end) return false;
	let changed = false;
	for (let rowIndex = start; rowIndex < end; ) {
		const sectionIndex = table.sectionIndexByRow[rowIndex];
		if (sectionIndex < 0) {
			rowIndex += 1;
			continue;
		}
		// Skip entire section if already materialized.
		if (cellStore.materializedSectionByIndex[sectionIndex] !== 0) {
			let nextRow = rowIndex + 1;
			while (nextRow < end && table.sectionIndexByRow[nextRow] === sectionIndex) {
				nextRow += 1;
			}
			rowIndex = nextRow;
			continue;
		}
		const startCell = table.sectionCellStartByRow[rowIndex];
		const cellCount = table.cellCountByRow[rowIndex];
		if (cellCount === 0) {
			rowIndex += 1;
			continue;
		}
		const cells = cellStore.logicalCellsBySectionIndex[sectionIndex];
		const endCell = startCell + cellCount;
		let rowFullyMaterialized = cells != null;
		if (rowFullyMaterialized) {
			for (let c = startCell; c < endCell; c += 1) {
				if (cells[c] === undefined) {
					rowFullyMaterialized = false;
					break;
				}
			}
		}
		if (rowFullyMaterialized) {
			rowIndex += 1;
			continue;
		}
		changed =
			materializeSectionCellRange(
				plan,
				sectionIndex,
				startCell,
				startCell + cellCount,
			) || changed;
		rowIndex += 1;
	}
	if (changed) {
		markTwoHopMaterializationChanged(plan);
	}
	return changed;
}

/**
 * Reads an already-materialized section-local cell.
 */
export function readTwoHopLogicalCellInSection(
	plan: TwoHopViewPlan,
	sectionIndex: number,
	sectionCellIndex: number,
): VirtualListLogicalCell<TwoHopVirtualListItem> | null {
	const sectionPlan = plan.sections[sectionIndex];
	if (
		!sectionPlan ||
		sectionCellIndex < 0 ||
		sectionCellIndex >= sectionPlan.cellCount
	) {
		return null;
	}
	return (
		plan.cellStore.logicalCellsBySectionIndex[sectionIndex]?.[sectionCellIndex] ??
		null
	);
}

/**
 * Resolves a section-local cell, materializing its section when needed.
 */
export function resolveTwoHopLogicalCellInSection(
	plan: TwoHopViewPlan,
	sectionIndex: number,
	sectionCellIndex: number,
): VirtualListLogicalCell<TwoHopVirtualListItem> | null {
	const sectionPlan = plan.sections[sectionIndex];
	if (
		!sectionPlan ||
		sectionCellIndex < 0 ||
		sectionCellIndex >= sectionPlan.cellCount
	) {
		return null;
	}
	const logicalCells = plan.cellStore.logicalCellsBySectionIndex[sectionIndex];
	const cached = logicalCells?.[sectionCellIndex];
	if (cached) return cached;
	ensureTwoHopSectionCellRangeMaterialized(
		plan,
		sectionIndex,
		sectionCellIndex,
		sectionCellIndex + 1,
	);
	return logicalCells?.[sectionCellIndex] ?? null;
}
