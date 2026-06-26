import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { StablePreviewScrollTopBand } from "ui/components/common/virtual-list/dom/activeScrollWindowGate";
import {
	logicalCellKey,
	sourceKey,
	type VirtualNavigationTarget,
	type VirtualRanges,
	type VirtualRow,
	type VirtualRowModel,
} from "ui/components/common/virtual-list/types";
import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { SectionLayout } from "ui/components/common/virtual-list/layout/viewPlanRowTypes";
import { getSectionPaginationKey } from "ui/components/common/virtual-list/pagination";
import type {
	TwoHopPageVirtualSection,
	TwoHopPageVirtualItem,
} from "./twohopPageVirtualModel";

import type { SectionedGridResolvedRowScratch } from "ui/components/common/virtual-list/row-models/sectionedGridMountedRows";

export interface TwoHopSectionPlan {
	readonly descriptor: SectionRenderDescriptor<
		TwoHopPageVirtualItem,
		TwoHopPageVirtualSection
	>;
	readonly sectionIndex: number;
	readonly sectionId: string;
	readonly sectionIdPrefix: string;
	readonly top: number;
	readonly height: number;
	readonly firstRowIndex: number;
	readonly rowCount: number;
	readonly firstCellIndex: number;
	readonly cellCount: number;
	readonly visibleCount: number;
	readonly showLoadMore: boolean;
	readonly mountedLayout: SectionLayout<
		TwoHopPageVirtualItem,
		TwoHopPageVirtualSection
	>;
}

/**
 * Per-section progress for background materialization.
 *
 * `nextCellIndex` is the background walk cursor: the next section-local cell
 * the background materializer will inspect. It only advances and never
 * reflects cells filled out-of-band.
 *
 * `materializedCellCount` is the number of cells in this section that are
 * currently materialized (cache filled) by *anyone* — synchronous
 * scroll-driven materialization or the background materializer alike. It is
 * updated at the single transition point where a cell goes from empty to
 * filled, so both paths share one source of truth and the background loop
 * never re-counts cells already filled by the scroll path.
 */
export interface TwoHopSectionMaterializationState {
	nextCellIndex: number;
	materializedCellCount: number;
}

export interface TwoHopCellStore {
	readonly logicalCellsBySectionIndex: Array<
		Array<VirtualListLogicalCell<TwoHopPageVirtualItem> | undefined>
	>;
	readonly materializationStateBySectionIndex: TwoHopSectionMaterializationState[];
	readonly materializedSectionByIndex: boolean[];
	nextUnmaterializedSectionIndex: number;
	remainingUnmaterializedCellCount: number;
	remainingUnmaterializedSectionCount: number;
	revision: number;
}

export interface TwoHopRowPlan {
	readonly sectionIndex: number;
	readonly rowIndexInSection: number;
	readonly sectionCellStartIndex: number;
	readonly cellCount: number;
	readonly top: number;
}

/**
 * Struct-of-typed-arrays storage for compiled per-row metadata.
 *
 * Backing the row table with typed arrays keeps recompiles (layout changes,
 * search updates, fold/unfold) off the major-GC sweep path: each recompile
 * allocates a handful of contiguous ArrayBuffers instead of one heap object
 * per row. Hot-path readers below access these arrays directly rather than
 * going through the `plan.rows` facade.
 */
export interface TwoHopRowTable {
	readonly rowCount: number;
	readonly sectionIndexByRow: Int32Array;
	readonly rowIndexInSectionByRow: Int32Array;
	readonly sectionCellStartByRow: Int32Array;
	readonly cellCountByRow: Uint16Array;
	readonly topByRow: Float64Array;
}

export interface TwoHopViewPlan {
	readonly sections: readonly TwoHopSectionPlan[];
	/**
	 * Compiled per-row metadata, indexed by the global row index.
	 *
	 * This is a lazy facade over {@link TwoHopViewPlan.rowTable}: each index
	 * access materializes a fresh `TwoHopRowPlan` snapshot. It is retained for
	 * external/test ergonomics; the scroll hot path reads `rowTable` directly
	 * to avoid per-access allocation.
	 */
	readonly rows: readonly TwoHopRowPlan[];
	readonly rowTable: TwoHopRowTable;
	readonly rowCount: number;
	readonly cellCount: number;
	readonly columns: number;
	readonly rowHeight: number;
	readonly rowGap: number;
	readonly totalHeight: number;
	readonly layout: ViewPlanLayoutMetrics;
	readonly cellStore: TwoHopCellStore;
}

/**
 * Reads a row-table entry as a `TwoHopRowPlan` snapshot, or null when the
 * row index is out of range.
 */
function readTwoHopRowTableAt(
	table: TwoHopRowTable,
	rowIndex: number,
): TwoHopRowPlan | null {
	if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
	return {
		sectionIndex: table.sectionIndexByRow[rowIndex],
		rowIndexInSection: table.rowIndexInSectionByRow[rowIndex],
		sectionCellStartIndex: table.sectionCellStartByRow[rowIndex],
		cellCount: table.cellCountByRow[rowIndex],
		top: table.topByRow[rowIndex],
	};
}

/**
 * Builds the `plan.rows` facade: a read-only, index-access-only view over a
 * row table that materializes `TwoHopRowPlan` snapshots on demand.
 */
function createTwoHopRowPlanFacade(table: TwoHopRowTable): readonly TwoHopRowPlan[] {
	return new Proxy([] as TwoHopRowPlan[], {
		get(_target, prop): unknown {
			if (prop === "length") return table.rowCount;
			if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
				return readTwoHopRowTableAt(table, Number(prop));
			}
			return undefined;
		},
	});
}

export type TwoHopViewPlanMaterialization =
	| { readonly kind: "eager" }
	| {
			readonly kind: "batched";
			readonly initial: {
				readonly maxSectionCount: number;
				readonly maxCellCount: number;
			};
			readonly background: {
				readonly maxCellCountPerSlice: number;
			};
	  };

export interface CompileTwoHopViewPlanParams {
	readonly sections: readonly SectionRenderDescriptor<
		TwoHopPageVirtualItem,
		TwoHopPageVirtualSection
	>[];
	readonly sectionVisibleCounts: Readonly<Record<string, number>>;
	readonly layout: ViewPlanLayoutMetrics;
	readonly materialization?: TwoHopViewPlanMaterialization;
	resolveInitialSectionVisibleCount(
		section: SectionRenderDescriptor<
			TwoHopPageVirtualItem,
			TwoHopPageVirtualSection
		>,
	): number;
	clampVisibleCount(
		section: SectionRenderDescriptor<
			TwoHopPageVirtualItem,
			TwoHopPageVirtualSection
		>,
		count: number,
	): number;
}

export interface TwoHopResolvedRow {
	readonly sectionIndex: number;
	readonly rowIndexInSection: number;
	readonly firstCellIndex: number;
	readonly sectionCellStartIndex: number;
	readonly cellCount: number;
	readonly top: number;
}

/**
 * Reads a compiled row plan entry, or null when the row index is out of range.
 */
export function readTwoHopRowPlan(
	plan: TwoHopViewPlan,
	rowIndex: number,
): TwoHopRowPlan | null {
	return readTwoHopRowTableAt(plan.rowTable, rowIndex);
}

export interface TwoHopBandRowTops {
	readonly previousStartRowTop: number | null;
	readonly currentStartRowTop: number | null;
	readonly previousEndRowTop: number | null;
	readonly currentEndRowTop: number | null;
}

type TwoHopBandRowTopsMutable = {
	-readonly [K in keyof TwoHopBandRowTops]: TwoHopBandRowTops[K];
};

export interface ResolveTwoHopRowTopsForBandParams {
	readonly startRow: number;
	readonly endRow: number;
}

interface TwoHopResolvedRowTop {
	readonly sectionIndex: number;
	readonly top: number;
}

/**
 * Compiles TwoHop data into section prefix metadata consumed while scrolling.
 */
export function compileTwoHopViewPlan(
	params: CompileTwoHopViewPlanParams,
): TwoHopViewPlan {
	const sections: TwoHopSectionPlan[] = [];
	const columns = Math.max(1, Math.floor(params.layout.columns));
	const rowHeight = Math.max(0, params.layout.rowHeight);
	const gap = Math.max(0, params.layout.gap);
	const sectionMarginBottom = Math.max(0, params.layout.sectionMarginBottom);
	const sectionCount = params.sections.length;
	const visibleCounts = new Uint32Array(sectionCount);
	const cellCounts = new Uint32Array(sectionCount);
	const rowCounts = new Uint32Array(sectionCount);
	const showLoadMoreBySection = new Uint8Array(sectionCount);
	const eagerItemsBySection: (readonly TwoHopPageVirtualItem[] | undefined)[] = [];
	const batchedMaterialization = params.materialization?.kind === "batched";
	let totalRowCount = 0;
	let totalCellCount = 0;

	for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
		const descriptor = params.sections[sectionIndex];
		const paginationKey = getSectionPaginationKey(descriptor);
		const visibleCount = params.clampVisibleCount(
			descriptor,
			params.sectionVisibleCounts[paginationKey] ??
				params.resolveInitialSectionVisibleCount(descriptor),
		);
		let visibleItemCount = visibleCount;
		if (!batchedMaterialization) {
			const items = descriptor.getItems();
			eagerItemsBySection.push(items);
			visibleItemCount = 0;
			for (let itemIndex = 0; itemIndex < visibleCount; itemIndex += 1) {
				if (items[itemIndex]) visibleItemCount += 1;
			}
		} else {
			eagerItemsBySection.push(undefined);
		}
		const showLoadMore = visibleCount < descriptor.loadedCount;
		const cellCount = 1 + visibleItemCount + (showLoadMore ? 1 : 0);
		const rowCount = Math.ceil(cellCount / columns);
		visibleCounts[sectionIndex] = visibleCount;
		cellCounts[sectionIndex] = cellCount;
		rowCounts[sectionIndex] = rowCount;
		showLoadMoreBySection[sectionIndex] = showLoadMore ? 1 : 0;
		totalCellCount += cellCount;
		totalRowCount += rowCount;
	}

	let top = 0;
	let nextCellIndex = 0;
	let nextRowIndex = 0;
	const sectionIndexByRow = new Int32Array(totalRowCount);
	const rowIndexInSectionByRow = new Int32Array(totalRowCount);
	const sectionCellStartByRow = new Int32Array(totalRowCount);
	const cellCountByRow = new Uint16Array(totalRowCount);
	const topByRow = new Float64Array(totalRowCount);
	const logicalCellsBySectionIndex: TwoHopCellStore["logicalCellsBySectionIndex"] =
		[];
	const rowStride = rowHeight + gap;

	for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
		const descriptor = params.sections[sectionIndex];
		const visibleCount = visibleCounts[sectionIndex];
		const cellCount = cellCounts[sectionIndex];
		const rowCount = rowCounts[sectionIndex];
		const showLoadMore = showLoadMoreBySection[sectionIndex] !== 0;
		const firstCellIndex = nextCellIndex;
		nextCellIndex += cellCount;

		const firstRowIndex = nextRowIndex;
		nextRowIndex += rowCount;
		const contentHeight =
			rowCount > 0 ? rowCount * rowHeight + (rowCount - 1) * gap : 0;
		const height = contentHeight + sectionMarginBottom;

		for (
			let rowIndexInSection = 0;
			rowIndexInSection < rowCount;
			rowIndexInSection += 1
		) {
			const sectionCellStartIndex = rowIndexInSection * columns;
			const writeIndex = firstRowIndex + rowIndexInSection;
			sectionIndexByRow[writeIndex] = sectionIndex;
			rowIndexInSectionByRow[writeIndex] = rowIndexInSection;
			sectionCellStartByRow[writeIndex] = sectionCellStartIndex;
			cellCountByRow[writeIndex] = Math.min(
				columns,
				cellCount - sectionCellStartIndex,
			);
			topByRow[writeIndex] = top + rowIndexInSection * rowStride;
		}
		const mountedLayout: SectionLayout<
			TwoHopPageVirtualItem,
			TwoHopPageVirtualSection
		> = {
			descriptor,
			sectionIndex,
			sectionId: descriptor.sectionId,
			visibleCount,
			showLoadMore,
			cellCount,
			rowCount,
			contentHeight,
			blockHeight: height,
			sectionTop: top,
		};
		logicalCellsBySectionIndex[sectionIndex] = new Array<
			VirtualListLogicalCell<TwoHopPageVirtualItem> | undefined
		>(cellCount);
		sections.push({
			descriptor,
			sectionIndex,
			sectionId: descriptor.sectionId,
			sectionIdPrefix: `${descriptor.sectionId}::`,
			top,
			height,
			firstRowIndex,
			rowCount,
			firstCellIndex,
			cellCount,
			visibleCount,
			showLoadMore,
			mountedLayout,
		});
		top += height;
	}

	const cellStore: TwoHopCellStore = {
		logicalCellsBySectionIndex,
		materializationStateBySectionIndex: sections.map(() => ({
			nextCellIndex: 0,
			materializedCellCount: 0,
		})),
		materializedSectionByIndex: new Array<boolean>(sections.length).fill(false),
		nextUnmaterializedSectionIndex: 0,
		remainingUnmaterializedCellCount: totalCellCount,
		remainingUnmaterializedSectionCount: sections.length,
		revision: 0,
	};
	const rowTable: TwoHopRowTable = {
		rowCount: totalRowCount,
		sectionIndexByRow,
		rowIndexInSectionByRow,
		sectionCellStartByRow,
		cellCountByRow,
		topByRow,
	};
	const plan: TwoHopViewPlan = {
		sections,
		rows: createTwoHopRowPlanFacade(rowTable),
		rowTable,
		rowCount: totalRowCount,
		cellCount: totalCellCount,
		columns,
		rowHeight,
		rowGap: gap,
		totalHeight: top,
		layout: params.layout,
		cellStore,
	};
	if (params.materialization?.kind === "batched") {
		const initialCellCount = Math.min(
			Math.max(0, Math.floor(params.materialization.initial.maxCellCount)),
			resolveInitialMaterializationCellCount(
				plan,
				params.materialization.initial.maxSectionCount,
			),
		);
		materializeNextTwoHopCellBatch(plan, {
			maxCellCount: initialCellCount,
		});
	} else {
		for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
			materializeTwoHopSectionCells(
				plan,
				sectionIndex,
				eagerItemsBySection[sectionIndex],
			);
		}
	}
	return plan;
}

function resolveInitialMaterializationCellCount(
	plan: TwoHopViewPlan,
	maxSectionCount: number | undefined,
): number {
	if (maxSectionCount === undefined) return 128;
	const sectionCount = Math.max(0, Math.floor(maxSectionCount));
	let cellCount = 0;
	for (
		let sectionIndex = 0;
		sectionIndex < Math.min(sectionCount, plan.sections.length);
		sectionIndex += 1
	) {
		cellCount += plan.sections[sectionIndex]?.cellCount ?? 0;
	}
	return cellCount;
}

function resolveTwoHopDescriptorItem(
	descriptor: SectionRenderDescriptor<
		TwoHopPageVirtualItem,
		TwoHopPageVirtualSection
	>,
	itemIndex: number,
	resolvedItems?: readonly TwoHopPageVirtualItem[],
): TwoHopPageVirtualItem | undefined {
	if (resolvedItems) return resolvedItems[itemIndex];
	if (descriptor.getItem) return descriptor.getItem(itemIndex);
	return descriptor.getItems()[itemIndex];
}

function createTwoHopLogicalCellAt(
	sectionPlan: TwoHopSectionPlan,
	cellIndex: number,
	resolvedItems?: readonly TwoHopPageVirtualItem[],
): VirtualListLogicalCell<TwoHopPageVirtualItem> | undefined {
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
	resolvedItems?: readonly TwoHopPageVirtualItem[],
): boolean {
	const logicalCells =
		plan.cellStore.logicalCellsBySectionIndex[sectionPlan.sectionIndex];
	if (!logicalCells || logicalCells[cellIndex]) return false;
	const cell = createTwoHopLogicalCellAt(sectionPlan, cellIndex, resolvedItems);
	if (!cell) return false;
	logicalCells[cellIndex] = cell;
	return true;
}

function markTwoHopMaterializationChanged(plan: TwoHopViewPlan): void {
	plan.cellStore.revision += 1;
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
	resolvedItems?: readonly TwoHopPageVirtualItem[],
): boolean {
	const sectionPlan = plan.sections[sectionIndex];
	const cellStore = plan.cellStore;
	if (!sectionPlan || cellStore.materializedSectionByIndex[sectionIndex]) {
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
	const state = cellStore.materializationStateBySectionIndex[sectionIndex];
	if (state) {
		const remainingCells = Math.max(
			0,
			sectionPlan.cellCount - state.materializedCellCount,
		);
		state.nextCellIndex = sectionPlan.cellCount;
		state.materializedCellCount = sectionPlan.cellCount;
		cellStore.remainingUnmaterializedCellCount = Math.max(
			0,
			cellStore.remainingUnmaterializedCellCount - remainingCells,
		);
	}
	markTwoHopSectionMaterialized(plan, sectionIndex);
	if (changed) {
		markTwoHopMaterializationChanged(plan);
	}
	return changed;
}

function markTwoHopSectionMaterialized(
	plan: TwoHopViewPlan,
	sectionIndex: number,
): void {
	const cellStore = plan.cellStore;
	if (cellStore.materializedSectionByIndex[sectionIndex]) return;
	cellStore.materializedSectionByIndex[sectionIndex] = true;
	cellStore.remainingUnmaterializedSectionCount -= 1;
}

/**
 * Records that one previously-empty cell in `sectionIndex` has just been
 * materialized, regardless of which path filled it.
 *
 * This is the single transition point that advances per-section and global
 * bookkeeping. Callers must invoke it exactly once for every cell that
 * transitions from empty to filled; calling it on an already-filled cell
 * would double-count. Section completion is surfaced to the caller via the
 * returned flag so each path can run its own section-advancement logic
 * (the background loop advances its section cursor; the scroll path only
 * marks the section).
 */
function recordTwoHopCellFilled(plan: TwoHopViewPlan, sectionIndex: number): boolean {
	const cellStore = plan.cellStore;
	const state = cellStore.materializationStateBySectionIndex[sectionIndex];
	const sectionPlan = plan.sections[sectionIndex];
	if (!state || !sectionPlan) return false;
	state.materializedCellCount += 1;
	cellStore.remainingUnmaterializedCellCount = Math.max(
		0,
		cellStore.remainingUnmaterializedCellCount - 1,
	);
	return state.materializedCellCount >= sectionPlan.cellCount;
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
		const state = cellStore.materializationStateBySectionIndex[sectionIndex];
		if (!sectionPlan || !state) {
			cellStore.nextUnmaterializedSectionIndex += 1;
			continue;
		}
		if (state.materializedCellCount >= sectionPlan.cellCount) {
			markTwoHopSectionMaterialized(plan, sectionIndex);
			cellStore.nextUnmaterializedSectionIndex += 1;
			continue;
		}
		// Fast-forward past cells that were already materialized out-of-band
		// (e.g. by synchronous scroll-driven materialization). They were
		// accounted for at their fill point, so re-walking them here would
		// double-count progress and waste the slice budget; skip them for free.
		const logicalCells = cellStore.logicalCellsBySectionIndex[sectionIndex];
		while (
			state.nextCellIndex < sectionPlan.cellCount &&
			logicalCells?.[state.nextCellIndex] !== undefined
		) {
			state.nextCellIndex += 1;
		}
		if (state.nextCellIndex >= sectionPlan.cellCount) {
			// Every remaining cell in this section is already materialized.
			if (state.materializedCellCount >= sectionPlan.cellCount) {
				markTwoHopSectionMaterialized(plan, sectionIndex);
			}
			cellStore.nextUnmaterializedSectionIndex += 1;
			continue;
		}
		const cellIndex = state.nextCellIndex;
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
			state.nextCellIndex += 1;
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
			state.nextCellIndex += 1;
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
	if (plan.cellStore.materializedSectionByIndex[sectionIndex]) return false;
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
		if (cellStore.materializedSectionByIndex[sectionIndex]) {
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
): VirtualListLogicalCell<TwoHopPageVirtualItem> | null {
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
): VirtualListLogicalCell<TwoHopPageVirtualItem> | null {
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

export function findTwoHopSectionIndexByRow(
	sections: readonly TwoHopSectionPlan[],
	rowIndex: number,
): number {
	if (rowIndex < 0 || sections.length === 0) return -1;
	let low = 0;
	let high = sections.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sections[mid].firstRowIndex > rowIndex) high = mid;
		else low = mid + 1;
	}
	const sectionIndex = low - 1;
	const section = sections[sectionIndex];
	if (!section || rowIndex >= section.firstRowIndex + section.rowCount) {
		return -1;
	}
	return sectionIndex;
}

export function resolveTwoHopRowInSection(
	plan: TwoHopViewPlan,
	sectionPlan: TwoHopSectionPlan,
	rowIndex: number,
): TwoHopResolvedRow | null {
	const table = plan.rowTable;
	if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
	const sectionIndex = table.sectionIndexByRow[rowIndex];
	if (sectionIndex !== sectionPlan.sectionIndex) return null;
	const rowIndexInSection = table.rowIndexInSectionByRow[rowIndex];
	const sectionCellStartIndex = table.sectionCellStartByRow[rowIndex];
	return {
		sectionIndex,
		rowIndexInSection,
		firstCellIndex: sectionPlan.firstCellIndex + sectionCellStartIndex,
		sectionCellStartIndex,
		cellCount: table.cellCountByRow[rowIndex],
		top: table.topByRow[rowIndex],
	};
}

/**
 * Into-style variant of {@link resolveTwoHopRowInSection} that writes into a
 * reusable scratch object instead of allocating a new object per call.
 * Only writes the 4 fields required by {@link SectionedGridResolvedRow}.
 */
export function resolveTwoHopRowInSectionInto(
	out: SectionedGridResolvedRowScratch,
	plan: TwoHopViewPlan,
	sectionPlan: TwoHopSectionPlan,
	rowIndex: number,
): boolean {
	const table = plan.rowTable;
	if (rowIndex < 0 || rowIndex >= table.rowCount) return false;
	if (table.sectionIndexByRow[rowIndex] !== sectionPlan.sectionIndex) return false;
	out.rowIndexInSection = table.rowIndexInSectionByRow[rowIndex];
	out.sectionCellStartIndex = table.sectionCellStartByRow[rowIndex];
	out.cellCount = table.cellCountByRow[rowIndex];
	out.top = table.topByRow[rowIndex];
	return true;
}

export function resolveTwoHopRow(
	plan: TwoHopViewPlan,
	rowIndex: number,
): TwoHopResolvedRow | null {
	const table = plan.rowTable;
	if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
	const sectionIndex = table.sectionIndexByRow[rowIndex];
	const sectionPlan = plan.sections[sectionIndex];
	const rowIndexInSection = table.rowIndexInSectionByRow[rowIndex];
	const sectionCellStartIndex = table.sectionCellStartByRow[rowIndex];
	return {
		sectionIndex,
		rowIndexInSection,
		firstCellIndex: sectionPlan.firstCellIndex + sectionCellStartIndex,
		sectionCellStartIndex,
		cellCount: table.cellCountByRow[rowIndex],
		top: table.topByRow[rowIndex],
	};
}

/**
 * Reads the top offset for a row, or null when the row index is out of range.
 * Returns a scalar to avoid allocating a tiny object.
 */
function readTwoHopRowTop(plan: TwoHopViewPlan, rowIndex: number): number | null {
	const table = plan.rowTable;
	if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
	return table.topByRow[rowIndex];
}

export function resolveTwoHopRowTopsForBandInto(
	out: TwoHopBandRowTopsMutable,
	plan: TwoHopViewPlan,
	params: ResolveTwoHopRowTopsForBandParams,
): void {
	out.previousStartRowTop = null;
	out.currentStartRowTop = null;
	out.previousEndRowTop = null;
	out.currentEndRowTop = null;
	if (params.startRow >= params.endRow) return;

	const currentStartTop = readTwoHopRowTop(plan, params.startRow);
	if (currentStartTop === null) return;

	const previousStartTop = readTwoHopRowTop(plan, params.startRow - 1);
	const previousEndTop = readTwoHopRowTop(plan, params.endRow - 1);
	const currentEndTop =
		previousEndTop !== null ? readTwoHopRowTop(plan, params.endRow) : null;

	out.previousStartRowTop = previousStartTop;
	out.currentStartRowTop = currentStartTop;
	out.previousEndRowTop = previousEndTop;
	out.currentEndRowTop = currentEndTop;
}

function upperBoundSectionTop(
	sections: readonly TwoHopSectionPlan[],
	target: number,
): number {
	let low = 0;
	let high = sections.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sections[mid].top > target) high = mid;
		else low = mid + 1;
	}
	return low;
}

function lowerBoundSectionTop(
	sections: readonly TwoHopSectionPlan[],
	target: number,
): number {
	let low = 0;
	let high = sections.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sections[mid].top >= target) high = mid;
		else low = mid + 1;
	}
	return low;
}

interface FirstTwoHopRowByTopResolution {
	readonly rowIndex: number;
	readonly sectionIndex: number;
}

interface FirstTwoHopRowByTopResolutionScratch {
	rowIndex: number;
	sectionIndex: number;
}

function writeFirstTwoHopRowByTopFromSection(
	out: FirstTwoHopRowByTopResolutionScratch,
	sections: readonly TwoHopSectionPlan[],
	rowStride: number,
	target: number,
	inclusive: boolean,
	sectionIndex: number,
	rowCount: number,
): void {
	const section = sections[sectionIndex];
	if (!section) {
		out.rowIndex = rowCount;
		out.sectionIndex = sections.length;
		return;
	}
	const relativeTarget = target - section.top;
	const rowIndexInSection = inclusive
		? Math.ceil(relativeTarget / rowStride)
		: Math.floor(relativeTarget / rowStride) + 1;
	const firstMatchingRowIndex = Math.max(0, rowIndexInSection);
	if (firstMatchingRowIndex < section.rowCount) {
		out.rowIndex = section.firstRowIndex + firstMatchingRowIndex;
		out.sectionIndex = sectionIndex;
		return;
	}
	const nextSectionIndex = sectionIndex + 1;
	const nextSection = sections[nextSectionIndex];
	if (nextSection) {
		out.rowIndex = nextSection.firstRowIndex;
		out.sectionIndex = nextSectionIndex;
	} else {
		out.rowIndex = rowCount;
		out.sectionIndex = sections.length;
	}
}

function canResolveFirstTwoHopRowByTopFromSection(
	sections: readonly TwoHopSectionPlan[],
	target: number,
	inclusive: boolean,
	sectionIndex: number,
): boolean {
	const nextSection = sections[sectionIndex + 1];
	if (!nextSection) return true;
	return target < nextSection.top || (inclusive && target === nextSection.top);
}

function writeFirstTwoHopRowByTop(
	out: FirstTwoHopRowByTopResolutionScratch,
	sections: readonly TwoHopSectionPlan[],
	rowStride: number,
	target: number,
	inclusive: boolean,
): void {
	if (sections.length === 0) {
		out.rowIndex = 0;
		out.sectionIndex = 0;
		return;
	}
	const lastSection = sections[sections.length - 1];
	const rowCount = lastSection.firstRowIndex + lastSection.rowCount;
	const boundaryIndex = inclusive
		? lowerBoundSectionTop(sections, target)
		: upperBoundSectionTop(sections, target);
	if (inclusive) {
		const matchingSection = sections[boundaryIndex];
		if (matchingSection?.top === target) {
			out.rowIndex = matchingSection.firstRowIndex;
			out.sectionIndex = boundaryIndex;
			return;
		}
	}
	if (rowStride <= 0) {
		const matchingSection = sections[boundaryIndex];
		if (matchingSection) {
			out.rowIndex = matchingSection.firstRowIndex;
			out.sectionIndex = boundaryIndex;
		} else {
			out.rowIndex = rowCount;
			out.sectionIndex = sections.length;
		}
		return;
	}
	const sectionIndex = Math.max(0, boundaryIndex - 1);
	writeFirstTwoHopRowByTopFromSection(
		out,
		sections,
		rowStride,
		target,
		inclusive,
		sectionIndex,
		rowCount,
	);
}

type FindTwoHopRowsByOffsetParams = {
	readonly sections: readonly TwoHopSectionPlan[];
	readonly rowHeight: number;
	readonly rowGap: number;
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly overscanPx: number;
};

/**
 * Core implementation of row-range resolution by scroll offset.
 *
 * Writes into `out` and reuses `resolutionScratch` across calls to avoid
 * per-call allocation. Prefer this variant on hot scroll paths.
 */
function writeTwoHopRowsByOffsetIntoScratch(
	out: RowRange,
	resolutionScratch: FirstTwoHopRowByTopResolutionScratch,
	sections: readonly TwoHopSectionPlan[],
	rowHeight: number,
	rowGap: number,
	scrollTop: number,
	viewportHeight: number,
	overscanPx: number,
): void {
	if (sections.length === 0 || viewportHeight <= 0) {
		out.start = 0;
		out.end = 0;
		return;
	}
	const normalizedOverscanPx = Math.max(0, overscanPx);
	const startOffset = scrollTop - normalizedOverscanPx;
	const endOffset = scrollTop + viewportHeight + normalizedOverscanPx;
	const rowStride = rowHeight + rowGap;
	const startTarget = startOffset - rowHeight;
	const endTarget = endOffset;
	writeFirstTwoHopRowByTop(
		resolutionScratch,
		sections,
		rowStride,
		startTarget,
		false,
	);
	const lastSection = sections[sections.length - 1];
	const rowCount = lastSection.firstRowIndex + lastSection.rowCount;
	const start = resolutionScratch.rowIndex;
	const startSectionIndex = resolutionScratch.sectionIndex;
	let endRow: number;
	if (
		rowStride > 0 &&
		canResolveFirstTwoHopRowByTopFromSection(
			sections,
			endTarget,
			true,
			startSectionIndex,
		)
	) {
		writeFirstTwoHopRowByTopFromSection(
			resolutionScratch,
			sections,
			rowStride,
			endTarget,
			true,
			startSectionIndex,
			rowCount,
		);
		endRow = resolutionScratch.rowIndex;
	} else {
		writeFirstTwoHopRowByTop(
			resolutionScratch,
			sections,
			rowStride,
			endTarget,
			true,
		);
		endRow = resolutionScratch.rowIndex;
	}
	out.start = start < endRow ? start : 0;
	out.end = start < endRow ? endRow : 0;
}

function writeTwoHopRowsByOffset(
	out: RowRange,
	sections: readonly TwoHopSectionPlan[],
	rowHeight: number,
	rowGap: number,
	scrollTop: number,
	viewportHeight: number,
	overscanPx: number,
): void {
	const resolutionScratch: FirstTwoHopRowByTopResolutionScratch = {
		rowIndex: 0,
		sectionIndex: 0,
	};
	writeTwoHopRowsByOffsetIntoScratch(
		out,
		resolutionScratch,
		sections,
		rowHeight,
		rowGap,
		scrollTop,
		viewportHeight,
		overscanPx,
	);
}

export function findTwoHopRowsByOffsetInto(
	out: RowRange,
	params: FindTwoHopRowsByOffsetParams,
): void {
	writeTwoHopRowsByOffset(
		out,
		params.sections,
		params.rowHeight,
		params.rowGap,
		params.scrollTop,
		params.viewportHeight,
		params.overscanPx,
	);
}

export function findTwoHopRowsByOffset(params: FindTwoHopRowsByOffsetParams): RowRange {
	const range = { start: 0, end: 0 };
	findTwoHopRowsByOffsetInto(range, params);
	return range;
}

type StablePreviewScrollTopBandMutable = {
	-readonly [K in keyof StablePreviewScrollTopBand]: StablePreviewScrollTopBand[K];
};

type WriteStablePreviewScrollTopBandParams = {
	readonly previewVisible: RowRange;
	readonly viewportHeight: number;
	readonly overscanPx: number;
};

function writeInvalidStablePreviewScrollTopBand(
	out: StablePreviewScrollTopBandMutable,
): void {
	out.min = Number.POSITIVE_INFINITY;
	out.max = Number.NEGATIVE_INFINITY;
}

function writeTwoHopStablePreviewScrollTopBand(
	out: StablePreviewScrollTopBandMutable,
	rowTops: TwoHopBandRowTopsMutable,
	plan: TwoHopViewPlan,
	params: WriteStablePreviewScrollTopBandParams,
): void {
	const range = params.previewVisible;
	if (range.start >= range.end || params.viewportHeight <= 0) {
		writeInvalidStablePreviewScrollTopBand(out);
		return;
	}

	resolveTwoHopRowTopsForBandInto(rowTops, plan, {
		startRow: range.start,
		endRow: range.end,
	});
	if (rowTops.currentStartRowTop === null || rowTops.previousEndRowTop === null) {
		writeInvalidStablePreviewScrollTopBand(out);
		return;
	}

	const normalizedOverscanPx = Math.max(0, params.overscanPx);
	const minForStart =
		rowTops.previousStartRowTop === null
			? Number.NEGATIVE_INFINITY
			: rowTops.previousStartRowTop + plan.rowHeight + normalizedOverscanPx;
	const maxForStart =
		rowTops.currentStartRowTop + plan.rowHeight + normalizedOverscanPx;
	const minForEnd =
		rowTops.previousEndRowTop - params.viewportHeight - normalizedOverscanPx;
	const maxForEnd =
		rowTops.currentEndRowTop === null
			? Number.POSITIVE_INFINITY
			: rowTops.currentEndRowTop - params.viewportHeight - normalizedOverscanPx;

	out.min = Math.max(minForStart, minForEnd);
	out.max = Math.min(maxForStart, maxForEnd);
	if (out.min >= out.max) {
		writeInvalidStablePreviewScrollTopBand(out);
	}
}

export interface TwoHopViewPlanRowModel extends VirtualRowModel<
	VirtualListLogicalCell<TwoHopPageVirtualItem>
> {
	readonly plan: TwoHopViewPlan;
	findVisibleRanges(params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
	findVisibleRangeInto(
		out: RowRange,
		params: {
			scrollTop: number;
			viewportHeight: number;
			overscanPx: number;
		},
	): void;
	findVisibleRangesInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
	findVisibleRangesFromMounted(params: {
		scrollTop: number;
		viewportHeight: number;
		mounted: RowRange;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
	findVisibleRangesFromMountedInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mounted: RowRange;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
	findStablePreviewScrollTopBandInto(
		out: StablePreviewScrollTopBandMutable,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
			previewVisible: RowRange;
		},
	): void;
	/**
	 * Computes the scrollTop band within which the mounted range is guaranteed
	 * not to change. Used as a pre-check before the expensive
	 * {@link findVisibleRangeInto} call on the active scroll path.
	 *
	 * Unlike {@link findStablePreviewScrollTopBandInto} which can return an
	 * infinite band when `previewOverscanPx >= mountedOverscanPx`, this method
	 * always computes a finite band from the actual mounted range boundaries.
	 */
	findStableMountedScrollTopBandInto(
		out: StablePreviewScrollTopBandMutable,
		params: {
			mountedOverscanPx: number;
			viewportHeight: number;
			mounted: RowRange;
		},
	): void;
	resolveRowTopsForBandInto(
		out: TwoHopBandRowTopsMutable,
		params: ResolveTwoHopRowTopsForBandParams,
	): void;
}

function copyRowRangeInto(out: RowRange, range: RowRange): void {
	out.start = range.start;
	out.end = range.end;
}

export function createTwoHopViewPlanRowModel(
	plan: TwoHopViewPlan,
): TwoHopViewPlanRowModel {
	const stablePreviewRowTops: TwoHopBandRowTopsMutable = {
		previousStartRowTop: null,
		currentStartRowTop: null,
		previousEndRowTop: null,
		currentEndRowTop: null,
	};
	// Reusable scratch for row-range resolution, held for the lifetime of
	// this row model to avoid per-scroll-frame allocation.
	const resolutionScratch: FirstTwoHopRowByTopResolutionScratch = {
		rowIndex: 0,
		sectionIndex: 0,
	};
	const writeVisibleRange = (
		out: RowRange,
		scrollTop: number,
		viewportHeight: number,
		overscanPx: number,
	): void => {
		writeTwoHopRowsByOffsetIntoScratch(
			out,
			resolutionScratch,
			plan.sections,
			plan.rowHeight,
			plan.rowGap,
			scrollTop,
			viewportHeight,
			overscanPx,
		);
	};
	const findRange = (params: {
		scrollTop: number;
		viewportHeight: number;
		overscanPx: number;
	}): RowRange => {
		const range = { start: 0, end: 0 };
		writeVisibleRange(
			range,
			params.scrollTop,
			params.viewportHeight,
			params.overscanPx,
		);
		return range;
	};
	const findRanges = (params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = Math.min(
			mountedOverscanPx,
			Math.max(0, params.previewOverscanPx ?? 0),
		);
		const mounted = { start: 0, end: 0 };
		writeVisibleRange(
			mounted,
			params.scrollTop,
			params.viewportHeight,
			mountedOverscanPx,
		);
		let previewVisible = mounted;
		if (previewOverscanPx < mountedOverscanPx) {
			previewVisible = { start: 0, end: 0 };
			writeVisibleRange(
				previewVisible,
				params.scrollTop,
				params.viewportHeight,
				previewOverscanPx,
			);
		}

		return {
			mounted,
			previewVisible,
		};
	};
	const findRangesInto = (
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = Math.min(
			mountedOverscanPx,
			Math.max(0, params.previewOverscanPx ?? 0),
		);
		writeVisibleRange(
			out.mounted,
			params.scrollTop,
			params.viewportHeight,
			mountedOverscanPx,
		);
		if (previewOverscanPx >= mountedOverscanPx) {
			copyRowRangeInto(out.previewVisible, out.mounted);
			return;
		}
		writeVisibleRange(
			out.previewVisible,
			params.scrollTop,
			params.viewportHeight,
			previewOverscanPx,
		);
	};
	const findRangesFromMounted = (params: {
		scrollTop: number;
		viewportHeight: number;
		mounted: RowRange;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = Math.min(
			mountedOverscanPx,
			Math.max(0, params.previewOverscanPx ?? 0),
		);
		let previewVisible = params.mounted;
		if (previewOverscanPx < mountedOverscanPx) {
			previewVisible = { start: 0, end: 0 };
			writeVisibleRange(
				previewVisible,
				params.scrollTop,
				params.viewportHeight,
				previewOverscanPx,
			);
		}
		return {
			mounted: params.mounted,
			previewVisible,
		};
	};
	const findRangesFromMountedInto = (
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mounted: RowRange;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = Math.min(
			mountedOverscanPx,
			Math.max(0, params.previewOverscanPx ?? 0),
		);
		copyRowRangeInto(out.mounted, params.mounted);
		if (previewOverscanPx >= mountedOverscanPx) {
			copyRowRangeInto(out.previewVisible, out.mounted);
			return;
		}
		writeVisibleRange(
			out.previewVisible,
			params.scrollTop,
			params.viewportHeight,
			previewOverscanPx,
		);
	};
	const findStablePreviewScrollTopBandInto = (
		out: StablePreviewScrollTopBandMutable,
		params: {
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
			previewVisible: RowRange;
		},
	): void => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = Math.min(
			mountedOverscanPx,
			Math.max(0, params.previewOverscanPx ?? 0),
		);
		if (previewOverscanPx >= mountedOverscanPx) {
			out.min = Number.NEGATIVE_INFINITY;
			out.max = Number.POSITIVE_INFINITY;
			return;
		}
		writeTwoHopStablePreviewScrollTopBand(out, stablePreviewRowTops, plan, {
			previewVisible: params.previewVisible,
			viewportHeight: params.viewportHeight,
			overscanPx: previewOverscanPx,
		});
	};
	const findStableMountedScrollTopBandInto = (
		out: StablePreviewScrollTopBandMutable,
		params: {
			mountedOverscanPx: number;
			viewportHeight: number;
			mounted: RowRange;
		},
	): void => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		writeTwoHopStablePreviewScrollTopBand(out, stablePreviewRowTops, plan, {
			previewVisible: params.mounted,
			viewportHeight: params.viewportHeight,
			overscanPx: mountedOverscanPx,
		});
	};
	const resolveRowTopsForBandInto = (
		out: TwoHopBandRowTopsMutable,
		params: ResolveTwoHopRowTopsForBandParams,
	): void => {
		resolveTwoHopRowTopsForBandInto(out, plan, params);
	};
	const table = plan.rowTable;
	const getRowCellCountAt = (rowIndex: number): number =>
		rowIndex < 0 || rowIndex >= table.rowCount ? 0 : table.cellCountByRow[rowIndex];
	const getRowTopAt = (rowIndex: number): number =>
		rowIndex < 0 || rowIndex >= table.rowCount ? 0 : table.topByRow[rowIndex];
	const resolveCell = (
		rowIndex: number,
		columnIndex: number,
	): VirtualListLogicalCell<TwoHopPageVirtualItem> | null => {
		if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
		const cellCount = table.cellCountByRow[rowIndex];
		if (columnIndex < 0 || columnIndex >= cellCount) return null;
		return resolveTwoHopLogicalCellInSection(
			plan,
			table.sectionIndexByRow[rowIndex],
			table.sectionCellStartByRow[rowIndex] + columnIndex,
		);
	};
	const resolveNavigationTarget = (
		_currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualNavigationTarget | null => {
		let rowIndex = currentPosition.rowIndex;
		let columnIndex = currentPosition.columnIndex;
		if (direction === "up") rowIndex -= 1;
		if (direction === "down") rowIndex += 1;
		if (direction === "left") columnIndex -= 1;
		if (direction === "right") columnIndex += 1;
		if (columnIndex < 0) {
			rowIndex -= 1;
			columnIndex = getRowCellCountAt(rowIndex) - 1;
		}
		const currentRowCellCount = getRowCellCountAt(rowIndex);
		if (currentRowCellCount <= 0) return null;
		if (columnIndex >= currentRowCellCount) {
			if (direction !== "right") columnIndex = currentRowCellCount - 1;
			else {
				rowIndex += 1;
				columnIndex = 0;
			}
		}
		const cell = resolveCell(rowIndex, columnIndex);
		if (!cell) return null;
		return {
			key: cell.key,
			rowTop: getRowTopAt(rowIndex),
		};
	};

	return {
		plan,
		revision: { kind: "opaque", token: plan },
		rowCount: plan.rowCount,
		totalHeight: plan.totalHeight,
		layout: { ...plan.layout, contentHeight: plan.totalHeight },
		getRow(
			rowIndex,
		): VirtualRow<VirtualListLogicalCell<TwoHopPageVirtualItem>> | null {
			if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
			return {
				key: rowIndex,
				index: rowIndex,
				top: table.topByRow[rowIndex],
				height: plan.rowHeight,
				bottomSpacing: plan.rowGap,
				cellCount: table.cellCountByRow[rowIndex],
				getCell(columnIndex) {
					return resolveCell(rowIndex, columnIndex);
				},
			};
		},
		getRowCellCount: getRowCellCountAt,
		getRowTop: getRowTopAt,
		getRowEnd: (rowIndex) => {
			if (rowIndex < 0 || rowIndex >= table.rowCount) return 0;
			return table.topByRow[rowIndex] + plan.rowHeight;
		},
		findVisibleRange: findRange,
		findVisibleRangeInto: (out, params) => {
			writeVisibleRange(
				out,
				params.scrollTop,
				params.viewportHeight,
				params.overscanPx,
			);
		},
		findVisibleRanges: findRanges,
		findVisibleRangesInto: findRangesInto,
		findVisibleRangesFromMounted: findRangesFromMounted,
		findVisibleRangesFromMountedInto: findRangesFromMountedInto,
		findStablePreviewScrollTopBandInto,
		findStableMountedScrollTopBandInto,
		resolveRowTopsForBandInto,
		resolveNavigationTarget,
	};
}
