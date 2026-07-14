import type { RowPreviewActivationRuntime } from "features/preview/scheduling/rowPreviewActivationRuntime";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type {
	MountedFlatHeaderCell,
	MountedFlatItemCell,
} from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import { createContiguousRowSlotAllocator } from "ui/components/common/virtual-list/core/reconciliation/contiguousRowSlotAllocator";
import type { RenderBodyKey } from "ui/components/common/virtual-list/renderRevision";
import type { RenderRevision } from "ui/components/common/virtual-list/renderRevision";
import {
	logicalCellKey,
	renderSlotKey,
	type LogicalCellKey,
	type RenderSlotKey,
} from "ui/components/common/virtual-list/types";
import type { VirtualizedItemResolvedVisibilityState } from "ui/components/common/virtual-list/svelte/virtualizedItemVisibilityState.svelte";
import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";
import type {
	VirtualCellElementRegistration,
	VirtualCellRegistrationOwner,
	VirtualCellRegistry,
} from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
import { dispatchVirtualCellWillRebind } from "ui/interactions/virtualCellRebind";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import { createTwoHopCellBinding, type TwoHopCellBinding } from "./twoHopCellBinding";
import type { TwoHopMountedCell, TwoHopMountedRowSlice } from "./twoHopMountedTypes";
import type {
	CompiledTwoHopCell,
	TwoHopSectionPlan,
	TwoHopViewPlan,
} from "./twoHopViewPlan";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;
type TwoHopMountedHeaderCell = MountedFlatHeaderCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

export interface TwoHopFixedCellSlotController extends VirtualCellRegistrationOwner {
	readonly cellSlotKey: number;
	readonly active: boolean;
	readonly logicalKey: LogicalCellKey;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly renderBodyKey: RenderBodyKey | undefined;
	readonly renderBodyKind: TwoHopMountedCell["renderBodyKind"];
	readonly mountedCell: TwoHopMountedCell | undefined;
	readonly binding: TwoHopCellBinding | null;
	bindCell(cell: TwoHopMountedCell): void;
	clear(): void;
}

export interface TwoHopFixedRowSlotController {
	readonly slotIndex: number;
	readonly active: boolean;
	readonly rowIndex: number;
	readonly top: number;
	readonly cells: readonly TwoHopFixedCellSlotController[];
	bindRow(row: TwoHopMountedRowSlice): void;
	clear(): void;
}

interface MutableTwoHopFixedRowSlotController extends TwoHopFixedRowSlotController {
	setCellCapacity(capacity: number): void;
}

export interface TwoHopFixedRowSlotPool {
	readonly controllers: readonly TwoHopFixedRowSlotController[];
	ensureCapacity(capacity: number, cellCapacity?: number): void;
	setCapacity(capacity: number, cellCapacity?: number): void;
	bindRow(row: TwoHopMountedRowSlice): void;
	clearSlot(slotIndex: number): void;
}

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
}

interface CellSlotRecord {
	readonly mutable: MutableMountedCellShell;
	readonly mounted: TwoHopMountedCell;
	readonly visibilityState: VirtualizedItemResolvedVisibilityState;
}

interface RowSlotRecord {
	readonly row: TwoHopMountedRowSlice;
	readonly cellSlots: CellSlotRecord[];
	active: boolean;
}

export interface TwoHopPhysicalSlotPreparation {
	readonly capacity: number;
	readonly poolChanged: boolean;
}

export interface TwoHopPhysicalSlotStore {
	readonly fixedRowSlotPool: TwoHopFixedRowSlotPool;
	readonly mountedRows: readonly TwoHopMountedRowSlice[];
	prepareCapacity(
		start: number,
		end: number,
		layoutKey: unknown,
		columns: number,
	): TwoHopPhysicalSlotPreparation;
	bindRow(plan: TwoHopViewPlan, logicalRowIndex: number): void;
	clearRow(logicalRowIndex: number): void;
	clearAll(): void;
	clearOutsideRange(start: number, end: number): void;
	setPreviewRange(start: number, end: number): void;
	getItemVisibilityState(
		cell: TwoHopMountedCell,
	): VirtualizedItemResolvedVisibilityState;
	getMountedCellByInteractionId(interactionId: string): TwoHopMountedCell | undefined;
	dispose(): void;
}

const EMPTY_LOGICAL_CELL = {
	kind: "header",
	key: "" as LogicalCellKey,
} as const satisfies VirtualListLogicalCell<TwoHopVirtualListItem>;
const EMPTY_SECTION = {} as TwoHopVirtualListSection;
const EMPTY_HEADER_PROPS: ClickableHeaderExtraProps = {};

function createCellController(
	cellSlotKey: number,
	initialCell?: TwoHopMountedCell,
): TwoHopFixedCellSlotController {
	let binding = $state.raw<TwoHopCellBinding | null>(
		initialCell ? createTwoHopCellBinding(initialCell, 0) : null,
	);
	if (initialCell && process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("twoHop.binding.commit");
	}
	let cellElement: HTMLElement | null = null;
	let cellRegistry: VirtualCellRegistry | null = null;
	let cellRegistration: VirtualCellElementRegistration | null = null;

	function registerCurrentBinding(): void {
		if (!binding || !cellElement || !cellRegistry) return;
		if (!cellRegistration) {
			cellRegistration = cellRegistry.createRegistration(cellElement);
		}
		cellRegistration.update(
			String(binding.logicalKey),
			binding.rowIndex,
			binding.columnIndex,
		);
	}

	function unregisterCurrentBinding(): void {
		cellRegistration?.unregister();
		cellRegistration = null;
	}

	return {
		cellSlotKey,
		get active() {
			return binding !== null;
		},
		get logicalKey() {
			return binding?.logicalKey ?? logicalCellKey("");
		},
		get rowIndex() {
			return binding?.rowIndex ?? -1;
		},
		get columnIndex() {
			return binding?.columnIndex ?? -1;
		},
		get renderBodyKey() {
			return binding?.renderBodyKey;
		},
		get renderBodyKind() {
			return binding?.renderKind ?? "header";
		},
		get mountedCell() {
			return binding?.mountedCell;
		},
		get binding() {
			return binding;
		},
		bindCell(nextCell): void {
			const previousBinding = binding;
			if (
				previousBinding &&
				previousBinding.logicalKey !== nextCell.key &&
				cellElement
			) {
				dispatchVirtualCellWillRebind(cellElement, {
					previousLogicalKey: String(previousBinding.logicalKey),
					nextLogicalKey: String(nextCell.key),
				});
			}
			const nextBinding = createTwoHopCellBinding(
				nextCell,
				(previousBinding?.epoch ?? -1) + 1,
			);
			binding = nextBinding;
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.binding.commit");
			}
			registerCurrentBinding();
		},
		clear(): void {
			if (binding && cellElement) {
				dispatchVirtualCellWillRebind(cellElement, {
					previousLogicalKey: String(binding.logicalKey),
					nextLogicalKey: "",
				});
			}
			binding = null;
			unregisterCurrentBinding();
		},
		attachElement(element, registry): void {
			if (cellElement === element && cellRegistry === registry) return;
			unregisterCurrentBinding();
			cellElement = element;
			cellRegistry = registry;
			registerCurrentBinding();
		},
		detachElement(element): void {
			if (cellElement !== element) return;
			unregisterCurrentBinding();
			cellElement = null;
			cellRegistry = null;
		},
	};
}

function createRowController(slotIndex: number): MutableTwoHopFixedRowSlotController {
	let active = $state(false);
	let rowIndex = $state(-1);
	let top = $state(0);
	const cells: TwoHopFixedCellSlotController[] = [];
	let revision = $state(0);
	return {
		slotIndex,
		get active() {
			return active;
		},
		get rowIndex() {
			return rowIndex;
		},
		get top() {
			return top;
		},
		get cells() {
			void revision;
			return cells;
		},
		setCellCapacity(capacity): void {
			if (cells.length === capacity) return;
			for (const cell of cells) cell.clear();
			cells.length = 0;
			for (let columnIndex = 0; columnIndex < capacity; columnIndex += 1) {
				cells.push(createCellController(slotIndex * capacity + columnIndex));
			}
			revision += 1;
		},
		bindRow(nextRow): void {
			this.setCellCapacity(Math.max(cells.length, nextRow.cells.length));
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.reboundRowSlot");
				for (const _cell of nextRow.cells) {
					recordCCLDevMeasurement("twoHop.reboundCellSlot");
				}
			}
			for (let index = 0; index < nextRow.cells.length; index += 1) {
				const nextCell = nextRow.cells[index];
				if (!nextCell) {
					cells[index]?.clear();
					continue;
				}
				const cellSlotKey = nextCell.cellSlotKey ?? nextCell.renderSlotIndex;
				const controller = cells[index];
				if (controller?.cellSlotKey === cellSlotKey) {
					controller.bindCell(nextCell);
					continue;
				}
				cells[index]?.clear();
				cells[index] = createCellController(cellSlotKey, nextCell);
			}
			for (let index = nextRow.cells.length; index < cells.length; index += 1) {
				cells[index]?.clear();
			}
			rowIndex = nextRow.rowIndex;
			top = nextRow.top;
			active = true;
			revision += 1;
		},
		clear(): void {
			if (!active) return;
			active = false;
			for (const cell of cells) cell.clear();
			revision += 1;
		},
	};
}

export function createTwoHopFixedRowSlotPool(): TwoHopFixedRowSlotPool {
	let controllers = $state.raw<readonly MutableTwoHopFixedRowSlotController[]>([]);
	let configuredCellCapacity = 0;

	function ensureCapacity(capacity: number, cellCapacity?: number): void {
		if (cellCapacity !== undefined) configuredCellCapacity = cellCapacity;
		for (const controller of controllers) {
			controller.setCellCapacity(configuredCellCapacity);
		}
		if (capacity <= controllers.length) return;
		const next = controllers.slice();
		for (let slotIndex = next.length; slotIndex < capacity; slotIndex += 1) {
			const controller = createRowController(slotIndex);
			controller.setCellCapacity(configuredCellCapacity);
			next.push(controller);
		}
		controllers = next;
	}

	function setCapacity(capacity: number, cellCapacity?: number): void {
		if (capacity >= controllers.length) {
			ensureCapacity(capacity, cellCapacity);
			return;
		}
		if (cellCapacity !== undefined) configuredCellCapacity = cellCapacity;
		for (let slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
			controllers[slotIndex]?.setCellCapacity(configuredCellCapacity);
		}
		for (let slotIndex = capacity; slotIndex < controllers.length; slotIndex += 1) {
			controllers[slotIndex]?.clear();
		}
		controllers = controllers.slice(0, capacity);
	}

	return {
		get controllers() {
			return controllers;
		},
		ensureCapacity,
		setCapacity,
		bindRow(row): void {
			const slotIndex = row.slotIndex ?? 0;
			ensureCapacity(slotIndex + 1);
			controllers[slotIndex]?.bindRow(row);
		},
		clearSlot(slotIndex): void {
			controllers[slotIndex]?.clear();
		},
	};
}

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
	};
	const visibilityState: VirtualizedItemResolvedVisibilityState = $state({
		visibility: "mounted",
	});
	return {
		mutable,
		mounted: createMountedCellView(mutable),
		visibilityState,
	};
}

function createMountedCellView(mutable: MutableMountedCellShell): TwoHopMountedCell {
	return {
		get key() {
			return mutable.key;
		},
		get logicalKey() {
			return mutable.logicalKey;
		},
		get renderSlotIndex() {
			return mutable.renderSlotIndex;
		},
		get renderSlotKey() {
			return mutable.renderSlotKey;
		},
		get cell() {
			return mutable.cell;
		},
		get rowIndex() {
			return mutable.rowIndex;
		},
		get rowIndexInSection() {
			return mutable.rowIndexInSection;
		},
		get columnIndex() {
			return mutable.columnIndex;
		},
		get rowTop() {
			return mutable.rowTop;
		},
		get sectionId() {
			return mutable.sectionId;
		},
		get cellMetadataKey() {
			return mutable.cellMetadataKey;
		},
		get renderBodyKey() {
			return mutable.renderBodyKey;
		},
		get position() {
			return mutable.position;
		},
		get cellSlotKey() {
			return mutable.cellSlotKey;
		},
		get renderBodyKind() {
			return mutable.renderBodyKind;
		},
		get renderBodySectionId() {
			return mutable.renderBodySectionId;
		},
		get renderBodySourceKey() {
			return mutable.renderBodySourceKey;
		},
		get renderBodyCellKey() {
			return mutable.renderBodyCellKey;
		},
		get renderBodyRevision() {
			return mutable.renderBodyRevision;
		},
		get section() {
			return mutable.section;
		},
		get title() {
			return mutable.title;
		},
		get totalCount() {
			return mutable.totalCount;
		},
		get headerProps() {
			return mutable.headerProps;
		},
	} as TwoHopMountedCell;
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

/** Owns all mutable physical row/cell state for one mounted surface. */
export function createTwoHopPhysicalSlotStore(params: {
	readonly rowPreviewActivationRuntime?: RowPreviewActivationRuntime;
}): TwoHopPhysicalSlotStore {
	const fixedRowSlotPool = createTwoHopFixedRowSlotPool();
	const rowSlotAllocator = createContiguousRowSlotAllocator();
	const rowSlots: RowSlotRecord[] = [];
	const mountedRows: TwoHopMountedRowSlice[] = [];
	const mountedCellsByInteractionId = new Map<string, TwoHopMountedCell>();
	let activeColumns = 0;
	let activePoolEpoch = -1;
	let previewStart = 0;
	let previewEnd = 0;
	const preparation: { capacity: number; poolChanged: boolean } = {
		capacity: 0,
		poolChanged: false,
	};
	const fallbackVisibilityState: VirtualizedItemResolvedVisibilityState = $state({
		visibility: "mounted",
	});

	function isMountedHeaderCell(
		cell: TwoHopMountedCell,
	): cell is TwoHopMountedHeaderCell {
		return cell.cell.kind === "header";
	}

	function isMountedItemCell(cell: TwoHopMountedCell): cell is TwoHopMountedItemCell {
		return cell.cell.kind === "item";
	}

	function resolveInteractionId(cell: TwoHopMountedCell): string | null {
		if (isMountedHeaderCell(cell)) {
			return cell.headerProps.interactionId ?? cell.sectionId;
		}
		if (!isMountedItemCell(cell)) return null;

		const item = cell.cell.item;
		return item.interactionId ?? createItemInteractionKey(item.item);
	}

	function indexRecord(record: RowSlotRecord): void {
		for (const cell of record.row.cells) {
			const interactionId = resolveInteractionId(cell);
			if (interactionId) mountedCellsByInteractionId.set(interactionId, cell);
		}
	}

	function unindexRecord(record: RowSlotRecord): void {
		for (const cell of record.row.cells) {
			const interactionId = resolveInteractionId(cell);
			if (
				interactionId &&
				mountedCellsByInteractionId.get(interactionId) === cell
			) {
				mountedCellsByInteractionId.delete(interactionId);
			}
		}
	}

	function clearRecord(record: RowSlotRecord): void {
		if (!record.active) return;
		params.rowPreviewActivationRuntime?.clearRow(record.row.rowIndex);
		unindexRecord(record);
		record.active = false;
		record.row.cells.length = 0;
		fixedRowSlotPool.clearSlot(record.row.slotIndex ?? 0);
	}

	function resetPool(columns: number, capacity: number): void {
		for (const record of rowSlots) clearRecord(record);
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

	function ensurePool(columns: number, capacity: number): void {
		const resized = activeColumns !== columns || rowSlots.length !== capacity;
		if (resized && process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("twoHop.physicalPool.resize");
		}
		if (activeColumns !== columns) {
			resetPool(columns, capacity);
			return;
		}
		fixedRowSlotPool.setCapacity(capacity, columns);
		for (let slotIndex = rowSlots.length; slotIndex < capacity; slotIndex += 1) {
			const record = createRowSlotRecord(slotIndex, columns);
			rowSlots.push(record);
			mountedRows.push(record.row);
		}
		for (let slotIndex = capacity; slotIndex < rowSlots.length; slotIndex += 1) {
			clearRecord(rowSlots[slotIndex]);
		}
		rowSlots.length = capacity;
		mountedRows.length = capacity;
	}

	function resolveVisibility(rowIndex: number): VirtualizedItemVisibility {
		return rowIndex >= previewStart && rowIndex < previewEnd
			? "visible"
			: "mounted";
	}

	function setRowVisibility(record: RowSlotRecord): void {
		if (!record.active) return;
		const visibility = resolveVisibility(record.row.rowIndex);
		for (let index = 0; index < record.row.cells.length; index += 1) {
			const state = record.cellSlots[index]?.visibilityState;
			if (state && state.visibility !== visibility) state.visibility = visibility;
		}
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
		mutable.key = compiledCell.logicalKey;
		mutable.logicalKey = compiledCell.logicalKey;
		mutable.cell = compiledCell.logicalCell;
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
	}

	return {
		fixedRowSlotPool,
		get mountedRows() {
			return mountedRows;
		},
		prepareCapacity(start, end, layoutKey, columns) {
			rowSlotAllocator.prepareRange({ start, end, layoutKey });
			preparation.poolChanged = activePoolEpoch !== rowSlotAllocator.epoch;
			activePoolEpoch = rowSlotAllocator.epoch;
			preparation.capacity = rowSlotAllocator.capacity;
			ensurePool(columns, preparation.capacity);
			return preparation;
		},
		bindRow(plan, logicalRowIndex): void {
			const slotIndex = rowSlotAllocator.resolveSlotIndex(logicalRowIndex);
			const record = rowSlots[slotIndex];
			if (!record) return;
			if (record.active && record.row.rowIndex !== logicalRowIndex) {
				params.rowPreviewActivationRuntime?.clearRow(record.row.rowIndex);
			}
			if (record.active) unindexRecord(record);
			const sectionIndex = plan.rowSectionIndex[logicalRowIndex];
			const sectionPlan = plan.sections[sectionIndex];
			if (!sectionPlan) {
				clearRecord(record);
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
			indexRecord(record);
			fixedRowSlotPool.bindRow(record.row);
			setRowVisibility(record);
		},
		clearRow(logicalRowIndex): void {
			if (rowSlotAllocator.capacity === 0) return;
			const slotIndex = rowSlotAllocator.resolveSlotIndex(logicalRowIndex);
			const record = rowSlots[slotIndex];
			if (record?.active && record.row.rowIndex === logicalRowIndex) {
				clearRecord(record);
			}
		},
		clearAll(): void {
			for (const record of rowSlots) clearRecord(record);
		},
		clearOutsideRange(start, end): void {
			for (const record of rowSlots) {
				if (
					record.active &&
					(record.row.rowIndex < start || record.row.rowIndex >= end)
				) {
					clearRecord(record);
				}
			}
		},
		setPreviewRange(start, end): void {
			if (previewStart === start && previewEnd === end) return;
			const previousStart = previewStart;
			const previousEnd = previewEnd;
			previewStart = start;
			previewEnd = end;
			if (previousStart < start) {
				for (
					let row = previousStart;
					row < Math.min(previousEnd, start);
					row += 1
				) {
					setLogicalRowVisibility(row);
				}
			}
			if (end < previousEnd) {
				for (
					let row = Math.max(previousStart, end);
					row < previousEnd;
					row += 1
				) {
					setLogicalRowVisibility(row);
				}
			}
			if (start < previousStart) {
				for (let row = start; row < Math.min(end, previousStart); row += 1) {
					setLogicalRowVisibility(row);
				}
			}
			if (previousEnd < end) {
				for (let row = Math.max(start, previousEnd); row < end; row += 1) {
					setLogicalRowVisibility(row);
				}
			}
		},
		getItemVisibilityState(cell) {
			const columns = Math.max(1, activeColumns);
			const slotIndex = Math.floor(cell.renderSlotIndex / columns);
			const columnIndex = cell.renderSlotIndex % columns;
			return (
				rowSlots[slotIndex]?.cellSlots[columnIndex]?.visibilityState ??
				fallbackVisibilityState
			);
		},
		getMountedCellByInteractionId(interactionId) {
			return mountedCellsByInteractionId.get(interactionId);
		},
		dispose(): void {
			for (const record of rowSlots) clearRecord(record);
			mountedCellsByInteractionId.clear();
			rowSlotAllocator.dispose();
		},
	};
}
