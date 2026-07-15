import type { TwoHopMountedCell, TwoHopMountedRowSlice } from "./twoHopMountedTypes";
import {
	logicalCellKey,
	type LogicalCellKey,
	type VirtualizedItemVisibilityState,
} from "ui/components/common/virtual-list/types";
import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";
import type { RenderBodyKey } from "ui/components/common/virtual-list/renderRevision";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type {
	VirtualCellElementRegistration,
	VirtualCellRegistrationOwner,
	VirtualCellRegistry,
} from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
import { createTwoHopCellBinding, type TwoHopCellBinding } from "./twoHopCellBinding";
import { prepareVirtualCellForRebind } from "ui/interactions/virtualCellRebind";

export interface TwoHopFixedCellSlotController extends VirtualCellRegistrationOwner {
	readonly cellSlotKey: number;
	readonly activationCandidateId: string;
	readonly active: boolean;
	readonly revision: number;
	readonly logicalKey: LogicalCellKey;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly visibilityState: VirtualizedItemVisibilityState;
	readonly renderBodyKey: RenderBodyKey | undefined;
	readonly renderBodyKind: TwoHopMountedCell["renderBodyKind"];
	readonly mountedCell: TwoHopMountedCell | undefined;
	readonly binding: TwoHopCellBinding | null;
	bindCell(cell: TwoHopMountedCell): void;
	setVisibility(visibility: VirtualizedItemVisibility): void;
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

interface TwoHopCellSlotSnapshot {
	readonly active: boolean;
	readonly binding: TwoHopCellBinding | null;
	readonly revision: number;
}

interface TwoHopRowSlotSnapshot {
	readonly active: boolean;
	readonly rowIndex: number;
	readonly top: number;
	readonly revision: number;
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
	const activationCandidateId = `slot:${cellSlotKey}`;
	const visibilityState = $state<VirtualizedItemVisibilityState>({
		visibility: "mounted",
	});
	let snapshot = $state.raw<TwoHopCellSlotSnapshot>({
		active: initialCell !== undefined,
		binding: initialCell ? createTwoHopCellBinding(initialCell, 0) : null,
		revision: 0,
	});
	let cellElement: HTMLElement | null = null;
	let cellRegistry: VirtualCellRegistry | null = null;
	let cellRegistration: VirtualCellElementRegistration | null = null;

	function registerCurrentBinding(): void {
		const binding = snapshot.binding;
		if (!snapshot.active || !binding || !cellElement || !cellRegistry) return;
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
		activationCandidateId,
		get active() {
			return snapshot.active;
		},
		get revision() {
			return snapshot.revision;
		},
		get logicalKey() {
			return snapshot.binding?.logicalKey ?? logicalCellKey("");
		},
		get rowIndex() {
			return snapshot.binding?.rowIndex ?? -1;
		},
		get columnIndex() {
			return snapshot.binding?.columnIndex ?? -1;
		},
		visibilityState,
		get renderBodyKey() {
			return snapshot.binding?.mountedCell.renderBodyKey;
		},
		get renderBodyKind() {
			return snapshot.binding?.renderKind ?? "header";
		},
		get mountedCell() {
			return snapshot.binding?.mountedCell;
		},
		get binding() {
			return snapshot.binding;
		},
		bindCell(nextCell): void {
			const previousBinding = snapshot.binding;
			if (
				previousBinding &&
				previousBinding.logicalKey !== nextCell.key &&
				cellElement
			) {
				prepareVirtualCellForRebind(
					cellElement,
					String(previousBinding.logicalKey),
					String(nextCell.key),
				);
			}
			const nextBinding = createTwoHopCellBinding(
				nextCell,
				(previousBinding?.epoch ?? -1) + 1,
			);
			snapshot = {
				active: true,
				binding: nextBinding,
				revision: snapshot.revision + 1,
			};
			registerCurrentBinding();
		},
		setVisibility(visibility): void {
			if (visibilityState.visibility === visibility) return;
			visibilityState.visibility = visibility;
		},
		clear(): void {
			if (snapshot.binding && cellElement) {
				prepareVirtualCellForRebind(
					cellElement,
					String(snapshot.binding.logicalKey),
					"",
				);
			}
			snapshot = {
				active: false,
				binding: null,
				revision: snapshot.revision + 1,
			};
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
	let snapshot = $state.raw<TwoHopRowSlotSnapshot>({
		active: false,
		rowIndex: -1,
		top: 0,
		revision: 0,
	});
	const cells: TwoHopFixedCellSlotController[] = [];
	return {
		slotIndex,
		get active() {
			return snapshot.active;
		},
		get rowIndex() {
			return snapshot.rowIndex;
		},
		get top() {
			return snapshot.top;
		},
		get cells() {
			void snapshot.revision;
			return cells;
		},
		setCellCapacity(capacity): void {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.fixedSlotPool.cellCapacityCheck");
			}
			if (cells.length === capacity) return;
			for (const cell of cells) cell.clear();
			cells.length = 0;
			for (let columnIndex = 0; columnIndex < capacity; columnIndex += 1) {
				cells.push(createCellController(slotIndex * capacity + columnIndex));
			}
			snapshot = {
				...snapshot,
				revision: snapshot.revision + 1,
			};
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
			snapshot = {
				active: true,
				rowIndex: nextRow.rowIndex,
				top: nextRow.top,
				revision: snapshot.revision + 1,
			};
		},
		clear(): void {
			if (!snapshot.active) return;
			for (const cell of cells) cell.clear();
			snapshot = {
				...snapshot,
				active: false,
				revision: snapshot.revision + 1,
			};
		},
	};
}

export function createTwoHopFixedRowSlotPool(): TwoHopFixedRowSlotPool {
	let controllers = $state.raw<readonly MutableTwoHopFixedRowSlotController[]>([]);
	let configuredCellCapacity = 0;

	function ensureCapacity(capacity: number, cellCapacity?: number): void {
		const nextCellCapacity = cellCapacity ?? configuredCellCapacity;
		if (
			capacity <= controllers.length &&
			nextCellCapacity === configuredCellCapacity
		) {
			return;
		}
		if (nextCellCapacity !== configuredCellCapacity) {
			configuredCellCapacity = nextCellCapacity;
			for (const controller of controllers) {
				controller.setCellCapacity(configuredCellCapacity);
			}
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
		const nextCellCapacity = cellCapacity ?? configuredCellCapacity;
		if (nextCellCapacity !== configuredCellCapacity) {
			configuredCellCapacity = nextCellCapacity;
			for (let slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
				controllers[slotIndex]?.setCellCapacity(configuredCellCapacity);
			}
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
			let controller = controllers[slotIndex];
			if (!controller) {
				ensureCapacity(slotIndex + 1);
				controller = controllers[slotIndex];
			}
			controller?.bindRow(row);
		},
		clearSlot(slotIndex): void {
			controllers[slotIndex]?.clear();
		},
	};
}
