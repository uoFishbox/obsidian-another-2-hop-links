import type { TwoHopMountedCell, TwoHopMountedRowSlice } from "./twoHopMountedTypes";
import type { LogicalCellKey } from "ui/components/common/virtual-list/types";
import type { RenderBodyKey } from "ui/components/common/virtual-list/renderRevision";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

export interface TwoHopFixedCellSlotController {
	readonly cellSlotKey: number;
	readonly logicalKey: LogicalCellKey;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly renderBodyKey: RenderBodyKey | undefined;
	readonly mountedCell: TwoHopMountedCell;
	bindCell(cell: TwoHopMountedCell): void;
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

export interface TwoHopFixedRowSlotPool {
	readonly controllers: readonly TwoHopFixedRowSlotController[];
	ensureCapacity(capacity: number): void;
	setCapacity(capacity: number): void;
	bindRow(row: TwoHopMountedRowSlice): void;
	clearSlot(slotIndex: number): void;
}

function createCellController(
	cellSlotKey: number,
	initialCell: TwoHopMountedCell,
): TwoHopFixedCellSlotController {
	let logicalKey = $state(initialCell.key);
	let rowIndex = $state(initialCell.rowIndex);
	let columnIndex = $state(initialCell.columnIndex);
	let renderBodyKey = $state(initialCell.renderBodyKey);
	let mountedCell = $state.raw(initialCell);
	let revision = $state(0);

	return {
		cellSlotKey,
		get logicalKey() {
			return logicalKey;
		},
		get rowIndex() {
			return rowIndex;
		},
		get columnIndex() {
			return columnIndex;
		},
		get renderBodyKey() {
			return renderBodyKey;
		},
		get mountedCell() {
			void revision;
			return mountedCell;
		},
		bindCell(nextCell): void {
			logicalKey = nextCell.key;
			rowIndex = nextCell.rowIndex;
			columnIndex = nextCell.columnIndex;
			renderBodyKey = nextCell.renderBodyKey;
			mountedCell = nextCell;
			revision += 1;
		},
	};
}

function createController(slotIndex: number): TwoHopFixedRowSlotController {
	let active = $state(false);
	let rowIndex = $state(-1);
	let top = $state(0);
	let cells = $state.raw<readonly TwoHopFixedCellSlotController[]>([]);
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
		bindRow(nextRow): void {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.reboundRowSlot");
				for (const _cell of nextRow.cells) {
					recordCCLDevMeasurement("twoHop.reboundCellSlot");
				}
			}
			const nextCells = cells.slice(0, nextRow.cells.length);
			for (let index = 0; index < nextRow.cells.length; index += 1) {
				const nextCell = nextRow.cells[index];
				if (!nextCell) continue;
				const cellSlotKey = nextCell.cellSlotKey ?? nextCell.renderSlotIndex;
				const controller = nextCells[index];
				if (controller?.cellSlotKey === cellSlotKey) {
					controller.bindCell(nextCell);
					continue;
				}
				nextCells[index] = createCellController(cellSlotKey, nextCell);
			}
			cells = nextCells;
			rowIndex = nextRow.rowIndex;
			top = nextRow.top;
			active = true;
			revision += 1;
		},
		clear(): void {
			if (!active) return;
			active = false;
			revision += 1;
		},
	};
}

export function createTwoHopFixedRowSlotPool(): TwoHopFixedRowSlotPool {
	let controllers = $state.raw<readonly TwoHopFixedRowSlotController[]>([]);

	function ensureCapacity(capacity: number): void {
		if (capacity <= controllers.length) return;
		const next = controllers.slice();
		for (let slotIndex = next.length; slotIndex < capacity; slotIndex += 1) {
			next.push(createController(slotIndex));
		}
		controllers = next;
	}

	function setCapacity(capacity: number): void {
		if (capacity >= controllers.length) {
			ensureCapacity(capacity);
			return;
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
