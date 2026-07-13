import type { TwoHopMountedCell, TwoHopMountedRowSlice } from "./twoHopMountedTypes";
import {
	logicalCellKey,
	type LogicalCellKey,
} from "ui/components/common/virtual-list/types";
import type { RenderBodyKey } from "ui/components/common/virtual-list/renderRevision";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type {
	VirtualCellElementRegistration,
	VirtualCellRegistrationOwner,
	VirtualCellRegistry,
} from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";

export interface TwoHopFixedCellSlotController extends VirtualCellRegistrationOwner {
	readonly cellSlotKey: number;
	readonly active: boolean;
	readonly logicalKey: LogicalCellKey;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly renderBodyKey: RenderBodyKey | undefined;
	readonly renderBodyKind: TwoHopMountedCell["renderBodyKind"];
	readonly mountedCell: TwoHopMountedCell | undefined;
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

function createCellController(
	cellSlotKey: number,
	initialCell?: TwoHopMountedCell,
): TwoHopFixedCellSlotController {
	let logicalKey = $state(initialCell?.key ?? logicalCellKey(""));
	let rowIndex = $state(initialCell?.rowIndex ?? -1);
	let columnIndex = $state(initialCell?.columnIndex ?? -1);
	let renderBodyKey = $state(initialCell?.renderBodyKey);
	let renderBodyKind = $state(initialCell?.renderBodyKind ?? "header");
	let mountedCell = $state.raw<TwoHopMountedCell | undefined>(initialCell);
	let active = $state(initialCell !== undefined);
	let revision = $state(0);
	let cellElement: HTMLElement | null = null;
	let cellRegistry: VirtualCellRegistry | null = null;
	let cellRegistration: VirtualCellElementRegistration | null = null;

	function registerCurrentBinding(): void {
		if (!active || !cellElement || !cellRegistry) return;
		if (!cellRegistration) {
			cellRegistration = cellRegistry.createRegistration(cellElement);
		}
		cellRegistration.update(String(logicalKey), rowIndex, columnIndex);
	}

	function unregisterCurrentBinding(): void {
		cellRegistration?.unregister();
		cellRegistration = null;
	}

	return {
		cellSlotKey,
		get active() {
			return active;
		},
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
		get renderBodyKind() {
			return renderBodyKind;
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
			renderBodyKind = nextCell.renderBodyKind;
			mountedCell = nextCell;
			revision += 1;
			active = true;
			registerCurrentBinding();
		},
		clear(): void {
			active = false;
			mountedCell = undefined;
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

function createController(slotIndex: number): MutableTwoHopFixedRowSlotController {
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
			const controller = createController(slotIndex);
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
