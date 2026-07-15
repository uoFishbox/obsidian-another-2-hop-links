import type { RowPreviewActivationRuntime } from "features/preview/scheduling/rowPreviewActivationRuntime";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import {
	renderSlotKey,
	type LogicalCellKey,
	type RenderSlotKey,
	type VirtualRanges,
} from "ui/components/common/virtual-list/types";
import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";
import type { RenderRevision } from "ui/components/common/virtual-list/renderRevision";
import { createContiguousRowSlotAllocator } from "ui/components/common/virtual-list/core/reconciliation/contiguousRowSlotAllocator";
import { createTwoHopFixedRowSlotPool } from "./twoHopFixedRowSlotPool.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import {
	type TwoHopSectionPlan,
	type CompiledTwoHopCell,
	type TwoHopViewPlan,
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";
import type { TwoHopMountedCell, TwoHopMountedRowSlice } from "./twoHopMountedTypes";
import type { TwoHopCellDisplayMetadata } from "./twoHopCellDisplayMetadata";

interface MutableMountedCellShell {
	key: LogicalCellKey;
	logicalKey: LogicalCellKey;
	renderSlotIndex: number;
	renderSlotKey: RenderSlotKey;
	cell: VirtualListLogicalCell<TwoHopVirtualListItem>;
	rowIndex: number;
	rowIndexInSection: number;
	columnIndex: number;
	rowTop: number;
	sectionId: string;
	cellMetadataKey: unknown;
	renderBodyKey: string | undefined;
	position: undefined;
	cellSlotKey: number;
	renderBodyKind: "item" | "header" | "load-more";
	renderBodySectionId: string;
	renderBodySourceKey: string | undefined;
	renderBodyCellKey: string | undefined;
	renderBodyRevision: RenderRevision | undefined;
	section: TwoHopVirtualListSection;
	title: string;
	totalCount: number;
	headerProps: ClickableHeaderExtraProps;
	reuseFamily: TwoHopCellDisplayMetadata["reuseFamily"];
	presentation: TwoHopCellDisplayMetadata["presentation"];
	interactionId: TwoHopCellDisplayMetadata["interactionId"];
}

interface CellSlotRecord {
	readonly mutable: MutableMountedCellShell;
	readonly mounted: TwoHopMountedCell;
}

interface RowSlotRecord {
	readonly row: TwoHopMountedRowSlice;
	readonly cellSlots: CellSlotRecord[];
	active: boolean;
}

const EMPTY_LOGICAL_CELL = {
	kind: "header",
	key: "" as LogicalCellKey,
} as const satisfies VirtualListLogicalCell<TwoHopVirtualListItem>;

const EMPTY_SECTION = {} as TwoHopVirtualListSection;
const EMPTY_HEADER_PROPS: ClickableHeaderExtraProps = {};

function createCellSlotRecord(renderSlotIndex: number): CellSlotRecord {
	if (process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("twoHop.scalarKernel.cellShellCreated");
	}
	const mutable: MutableMountedCellShell = {
		key: EMPTY_LOGICAL_CELL.key,
		logicalKey: EMPTY_LOGICAL_CELL.key,
		renderSlotIndex,
		renderSlotKey: renderSlotKey(renderSlotIndex),
		cell: EMPTY_LOGICAL_CELL,
		rowIndex: -1,
		rowIndexInSection: -1,
		columnIndex: 0,
		rowTop: 0,
		sectionId: "",
		cellMetadataKey: undefined,
		renderBodyKey: undefined,
		position: undefined,
		cellSlotKey: renderSlotIndex,
		renderBodyKind: "header",
		renderBodySectionId: "",
		renderBodySourceKey: undefined,
		renderBodyCellKey: undefined,
		renderBodyRevision: undefined,
		section: EMPTY_SECTION,
		title: "",
		totalCount: 0,
		headerProps: EMPTY_HEADER_PROPS,
		reuseFamily: null,
		presentation: null,
		interactionId: null,
	};
	return {
		mutable,
		mounted: mutable as unknown as TwoHopMountedCell,
	};
}

function createRowSlotRecord(slotIndex: number, columns: number): RowSlotRecord {
	if (process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("twoHop.scalarKernel.rowShellCreated");
	}
	const cells: TwoHopMountedCell[] = [];
	const cellSlots: CellSlotRecord[] = [];
	for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
		cellSlots.push(createCellSlotRecord(slotIndex * columns + columnIndex));
	}
	return {
		row: {
			slotIndex,
			slotKey: slotIndex,
			rowIndex: -1,
			rowKey: -1,
			key: -1,
			top: 0,
			cells,
		},
		cellSlots,
		active: false,
	};
}

function resolveVisibility(
	rowIndex: number,
	previewStart: number,
	previewEnd: number,
): VirtualizedItemVisibility {
	return rowIndex >= previewStart && rowIndex < previewEnd ? "visible" : "mounted";
}

export interface TwoHopScalarKernelSnapshot {
	readonly rowModel: TwoHopViewPlanRowModel;
	readonly ranges: VirtualRanges;
	readonly totalHeight: number;
}

export function createTwoHopScalarScrollKernel(params: {
	readonly initialRowModel: TwoHopViewPlanRowModel;
	readonly rowPreviewActivationRuntime?: RowPreviewActivationRuntime;
	onStableVisibleRange(): void;
}) {
	const fixedRowSlotPool = createTwoHopFixedRowSlotPool();
	const rowSlotAllocator = createContiguousRowSlotAllocator();
	let rowModel = $state.raw(params.initialRowModel);
	const mountedRange = $state({ start: 0, end: 0 });
	const previewRange = $state({ start: 0, end: 0 });
	const ranges: VirtualRanges = {
		mounted: mountedRange,
		previewVisible: previewRange,
	};
	let initialized = false;
	let activePlan: TwoHopViewPlan | null = null;
	let activeColumns = 0;
	let activePoolEpoch = -1;
	let pendingDirtyStart = Number.POSITIVE_INFINITY;
	let pendingDirtyEnd = Number.NEGATIVE_INFINITY;
	const rowSlots: RowSlotRecord[] = [];
	const mountedRows: TwoHopMountedRowSlice[] = [];
	const rangeScratch: VirtualRanges = {
		mounted: { start: 0, end: 0 },
		previewVisible: { start: 0, end: 0 },
	};
	const snapshot: TwoHopScalarKernelSnapshot = {
		get rowModel() {
			return rowModel;
		},
		ranges,
		get totalHeight() {
			return rowModel.totalHeight;
		},
	};

	const skippedResult = {
		kind: "skipped",
		reason: "unstable",
		updateKind: "skipped",
	} as const;
	const bootstrappedRecomputedResult = {
		kind: "bootstrapped",
		range: mountedRange,
		updateKind: "recomputed",
	} as const;
	const stableRecomputedResult = {
		kind: "stable",
		range: mountedRange,
		updateKind: "recomputed",
	} as const;
	const stableReusedResult = {
		kind: "stable",
		range: mountedRange,
		updateKind: "reused",
	} as const;

	function clearRowSlot(record: RowSlotRecord): void {
		if (!record.active) return;
		params.rowPreviewActivationRuntime?.clearRow(record.row.rowIndex);
		record.active = false;
		record.row.cells.length = 0;
		fixedRowSlotPool.clearSlot(record.row.slotIndex ?? 0);
	}

	function resetPhysicalPool(columns: number, capacity: number): void {
		for (const record of rowSlots) clearRowSlot(record);
		rowSlots.length = 0;
		mountedRows.length = 0;
		activeColumns = columns;
		for (let slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
			const record = createRowSlotRecord(slotIndex, columns);
			rowSlots.push(record);
			mountedRows.push(record.row);
		}
		fixedRowSlotPool.setCapacity(capacity, columns);
	}

	function ensurePhysicalPool(columns: number, capacity: number): void {
		if (activeColumns !== columns) {
			resetPhysicalPool(columns, capacity);
			return;
		}
		fixedRowSlotPool.setCapacity(capacity, columns);
		for (let slotIndex = rowSlots.length; slotIndex < capacity; slotIndex += 1) {
			const record = createRowSlotRecord(slotIndex, columns);
			rowSlots.push(record);
			mountedRows.push(record.row);
		}
		for (let slotIndex = capacity; slotIndex < rowSlots.length; slotIndex += 1) {
			clearRowSlot(rowSlots[slotIndex]);
		}
		rowSlots.length = capacity;
		mountedRows.length = capacity;
	}

	function setRowVisibility(record: RowSlotRecord): void {
		if (!record.active) return;
		const visibility = resolveVisibility(
			record.row.rowIndex,
			previewRange.start,
			previewRange.end,
		);
		const rowController = fixedRowSlotPool.controllers[record.row.slotIndex ?? 0];
		rowController?.setVisibility(visibility);
		params.rowPreviewActivationRuntime?.setRowVisibility(
			record.row.rowIndex,
			visibility,
		);
	}

	function setLogicalRowVisibility(rowIndex: number): void {
		if (rowSlotAllocator.capacity === 0) return;
		const slotIndex = rowSlotAllocator.resolveSlotIndex(rowIndex);
		const record = rowSlots[slotIndex];
		if (!record?.active || record.row.rowIndex !== rowIndex) return;
		setRowVisibility(record);
	}

	function clearLogicalRowIfStillBound(rowIndex: number): void {
		if (rowSlotAllocator.capacity === 0) return;
		const slotIndex = rowSlotAllocator.resolveSlotIndex(rowIndex);
		const record = rowSlots[slotIndex];
		if (record?.active && record.row.rowIndex === rowIndex) {
			clearRowSlot(record);
		}
	}

	function populateCell(
		slot: CellSlotRecord,
		compiledCell: CompiledTwoHopCell,
		sectionPlan: TwoHopSectionPlan,
		rowIndex: number,
		rowIndexInSection: number,
		columnIndex: number,
		rowTop: number,
	): void {
		const mutable = slot.mutable;
		const descriptor = sectionPlan.descriptor;
		const logicalCell = compiledCell.logicalCell;
		mutable.key = compiledCell.logicalKey;
		mutable.logicalKey = compiledCell.logicalKey;
		mutable.cell = logicalCell;
		mutable.rowIndex = rowIndex;
		mutable.rowIndexInSection = rowIndexInSection;
		mutable.columnIndex = columnIndex;
		mutable.rowTop = rowTop;
		mutable.sectionId = descriptor.sectionId;
		mutable.section = descriptor.section;
		mutable.title = descriptor.title;
		mutable.totalCount = descriptor.totalCount;
		mutable.headerProps = descriptor.headerProps;
		mutable.renderBodyKind = compiledCell.renderBodyKind;
		mutable.renderBodySectionId = compiledCell.renderBodySectionId;
		mutable.renderBodySourceKey = compiledCell.renderBodySourceKey;
		mutable.renderBodyCellKey = compiledCell.renderBodyCellKey;
		mutable.renderBodyRevision = compiledCell.renderBodyRevision;
		mutable.renderBodyKey = compiledCell.renderBodyKey;
		mutable.reuseFamily = compiledCell.reuseFamily;
		mutable.presentation = compiledCell.presentation;
		mutable.interactionId = compiledCell.interactionId;
	}

	function bindLogicalRow(plan: TwoHopViewPlan, logicalRowIndex: number): void {
		const slotIndex = rowSlotAllocator.resolveSlotIndex(logicalRowIndex);
		const record = rowSlots[slotIndex];
		if (!record) return;
		if (record.active && record.row.rowIndex !== logicalRowIndex) {
			params.rowPreviewActivationRuntime?.clearRow(record.row.rowIndex);
		}
		const sectionIndex = plan.rowSectionIndex[logicalRowIndex];
		const sectionPlan = plan.sections[sectionIndex];
		if (!sectionPlan) {
			clearRowSlot(record);
			return;
		}
		const rowIndexInSection = logicalRowIndex - sectionPlan.firstRowIndex;
		const cellCount = plan.rowCellCount[logicalRowIndex];
		const rowTop = plan.rowTop[logicalRowIndex];
		record.row.rowIndex = logicalRowIndex;
		record.row.rowKey = logicalRowIndex;
		record.row.key = logicalRowIndex;
		record.row.top = rowTop;
		for (let columnIndex = 0; columnIndex < cellCount; columnIndex += 1) {
			const compiledCell =
				plan.cells[plan.rowFirstCellIndex[logicalRowIndex] + columnIndex];
			const cellSlot = record.cellSlots[columnIndex];
			if (!compiledCell || !cellSlot) {
				params.rowPreviewActivationRuntime?.clearRow(logicalRowIndex);
				record.row.cells.length = 0;
				record.active = false;
				fixedRowSlotPool.clearSlot(record.row.slotIndex ?? 0);
				return;
			}
			populateCell(
				cellSlot,
				compiledCell,
				sectionPlan,
				logicalRowIndex,
				rowIndexInSection,
				columnIndex,
				rowTop,
			);
			record.row.cells[columnIndex] = cellSlot.mounted;
		}
		record.row.cells.length = cellCount;
		record.active = true;
		fixedRowSlotPool.bindRow(record.row);
		setRowVisibility(record);
	}

	function isRowInRange(rowIndex: number, start: number, end: number): boolean {
		return rowIndex >= start && rowIndex < end;
	}

	function applyMountedRange(
		plan: TwoHopViewPlan,
		nextStart: number,
		nextEnd: number,
	): boolean {
		const previousStart = mountedRange.start;
		const previousEnd = mountedRange.end;
		const planChanged = activePlan !== plan;
		rowSlotAllocator.prepareRange({
			start: nextStart,
			end: nextEnd,
			layoutKey: plan.layout,
		});
		const poolChanged = activePoolEpoch !== rowSlotAllocator.epoch;
		activePoolEpoch = rowSlotAllocator.epoch;
		ensurePhysicalPool(plan.columns, rowSlotAllocator.capacity);

		const hasDirtyRows =
			pendingDirtyStart < pendingDirtyEnd &&
			pendingDirtyStart < nextEnd &&
			pendingDirtyEnd > nextStart;
		const rangeChanged = previousStart !== nextStart || previousEnd !== nextEnd;
		if (!planChanged && !poolChanged && !rangeChanged && !hasDirtyRows) {
			return false;
		}

		if (rowSlotAllocator.capacity === 0) {
			for (const record of rowSlots) clearRowSlot(record);
		} else if (planChanged || poolChanged) {
			for (const record of rowSlots) {
				if (poolChanged) {
					clearRowSlot(record);
					continue;
				}
				if (
					record.active &&
					!isRowInRange(record.row.rowIndex, nextStart, nextEnd)
				) {
					clearRowSlot(record);
				}
			}
			for (let rowIndex = nextStart; rowIndex < nextEnd; rowIndex += 1) {
				bindLogicalRow(plan, rowIndex);
			}
		} else {
			const enteringLeadingEnd = Math.min(nextEnd, previousStart);
			for (
				let rowIndex = nextStart;
				rowIndex < enteringLeadingEnd;
				rowIndex += 1
			) {
				bindLogicalRow(plan, rowIndex);
			}
			const enteringTrailingStart = Math.max(nextStart, previousEnd);
			for (
				let rowIndex = enteringTrailingStart;
				rowIndex < nextEnd;
				rowIndex += 1
			) {
				bindLogicalRow(plan, rowIndex);
			}
			if (hasDirtyRows) {
				const dirtyStart = Math.max(nextStart, pendingDirtyStart);
				const dirtyEnd = Math.min(nextEnd, pendingDirtyEnd);
				for (let rowIndex = dirtyStart; rowIndex < dirtyEnd; rowIndex += 1) {
					bindLogicalRow(plan, rowIndex);
				}
			}
			const leavingLeadingEnd = Math.min(previousEnd, nextStart);
			for (
				let rowIndex = previousStart;
				rowIndex < leavingLeadingEnd;
				rowIndex += 1
			) {
				clearLogicalRowIfStillBound(rowIndex);
			}
			const leavingTrailingStart = Math.max(previousStart, nextEnd);
			for (
				let rowIndex = leavingTrailingStart;
				rowIndex < previousEnd;
				rowIndex += 1
			) {
				clearLogicalRowIfStillBound(rowIndex);
			}
		}

		activePlan = plan;
		pendingDirtyStart = Number.POSITIVE_INFINITY;
		pendingDirtyEnd = Number.NEGATIVE_INFINITY;
		mountedRange.start = nextStart;
		mountedRange.end = nextEnd;
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("twoHop.scalarKernel.mountedRangeCommit");
		}
		return true;
	}

	function applyPreviewRange(nextStart: number, nextEnd: number): void {
		if (previewRange.start === nextStart && previewRange.end === nextEnd) return;
		const previousStart = previewRange.start;
		const previousEnd = previewRange.end;
		previewRange.start = nextStart;
		previewRange.end = nextEnd;
		if (previousStart < nextStart) {
			for (
				let rowIndex = previousStart;
				rowIndex < Math.min(previousEnd, nextStart);
				rowIndex += 1
			) {
				setLogicalRowVisibility(rowIndex);
			}
		}
		if (nextEnd < previousEnd) {
			for (
				let rowIndex = Math.max(previousStart, nextEnd);
				rowIndex < previousEnd;
				rowIndex += 1
			) {
				setLogicalRowVisibility(rowIndex);
			}
		}
		if (nextStart < previousStart) {
			for (
				let rowIndex = nextStart;
				rowIndex < Math.min(nextEnd, previousStart);
				rowIndex += 1
			) {
				setLogicalRowVisibility(rowIndex);
			}
		}
		if (previousEnd < nextEnd) {
			for (
				let rowIndex = Math.max(nextStart, previousEnd);
				rowIndex < nextEnd;
				rowIndex += 1
			) {
				setLogicalRowVisibility(rowIndex);
			}
		}
	}

	function applyResolvedRanges(
		nextRowModel: TwoHopViewPlanRowModel,
		nextRanges: VirtualRanges,
	): boolean {
		rowModel = nextRowModel;
		const mountedStart = Math.max(
			0,
			Math.min(nextRowModel.rowCount, nextRanges.mounted.start),
		);
		const mountedEnd = Math.max(
			mountedStart,
			Math.min(nextRowModel.rowCount, nextRanges.mounted.end),
		);
		const previewStart = Math.max(mountedStart, nextRanges.previewVisible.start);
		const previewEnd = Math.min(mountedEnd, nextRanges.previewVisible.end);
		applyPreviewRange(previewStart, previewEnd);
		const changed = applyMountedRange(nextRowModel.plan, mountedStart, mountedEnd);
		return changed;
	}

	function applyMeasurement(input: {
		rowModel: TwoHopViewPlanRowModel;
		scrollTop: number;
		viewportHeight: number;
		sectionTop: number;
		isStableMeasurement: boolean;
		isScrollActive: boolean;
		hasStableVisibleRange: boolean;
		precomputedRanges?: VirtualRanges;
		visibilityPolicy: {
			bootstrapRows: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		};
	}) {
		if (!input.isStableMeasurement) return skippedResult;
		if (input.precomputedRanges) {
			rangeScratch.mounted.start = input.precomputedRanges.mounted.start;
			rangeScratch.mounted.end = input.precomputedRanges.mounted.end;
			rangeScratch.previewVisible.start =
				input.precomputedRanges.previewVisible.start;
			rangeScratch.previewVisible.end =
				input.precomputedRanges.previewVisible.end;
		} else {
			input.rowModel.findVisibleRangesInto(rangeScratch, {
				scrollTop: input.scrollTop - input.sectionTop,
				viewportHeight: input.viewportHeight,
				mountedOverscanPx: input.visibilityPolicy.mountedOverscanPx,
				previewOverscanPx: input.visibilityPolicy.previewOverscanPx,
			});
		}
		const changed = applyResolvedRanges(input.rowModel, rangeScratch);
		if (!initialized) {
			initialized = true;
			return bootstrappedRecomputedResult;
		}
		params.onStableVisibleRange();
		return changed ? stableRecomputedResult : stableReusedResult;
	}

	return {
		fixedRowSlotPool,
		get mountedRows() {
			return mountedRows;
		},
		getSnapshot(): TwoHopScalarKernelSnapshot | null {
			return initialized ? snapshot : null;
		},
		applyMeasurement,
		recompute(input: { rowModel: TwoHopViewPlanRowModel }): void {
			if (!initialized) return;
			rangeScratch.mounted.start = mountedRange.start;
			rangeScratch.mounted.end = mountedRange.end;
			rangeScratch.previewVisible.start = previewRange.start;
			rangeScratch.previewVisible.end = previewRange.end;
			applyResolvedRanges(input.rowModel, rangeScratch);
		},
		markDirtyRows(range: RowRange): void {
			pendingDirtyStart = Math.min(pendingDirtyStart, range.start);
			pendingDirtyEnd = Math.max(pendingDirtyEnd, range.end);
		},
		syncPreviewVisibleRange(start: number, end: number): void {
			applyPreviewRange(start, end);
		},
		cancelPreviewVisibleRangeSync(): void {},
		dispose(): void {
			for (const record of rowSlots) clearRowSlot(record);
			rowSlotAllocator.dispose();
		},
	};
}

export type TwoHopScalarScrollKernel = ReturnType<
	typeof createTwoHopScalarScrollKernel
>;
