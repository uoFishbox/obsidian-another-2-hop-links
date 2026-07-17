import type { RowPreviewActivationRuntime } from "features/preview/scheduling/rowPreviewActivationRuntime";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { createResidentRowSlotAllocator } from "ui/virtualization/residentSlotAllocator";
import {
	logicalCellKey,
	renderSlotKey,
	type LogicalCellKey,
	type MountedVirtualCell,
} from "ui/components/common/virtual-list/types";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";
import type {
	VirtualCellElementRegistration,
	VirtualCellRegistrationOwner,
	VirtualCellRegistry,
} from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
import type { VirtualSurfaceMountedRow } from "ui/components/common/virtual-list/svelte/VirtualSurfaceTypes";
import { dispatchVirtualCellWillRebind } from "ui/interactions/virtualCellRebind";
import {
	createTwoHopCellBinding,
	type TwoHopCellBinding,
	type TwoHopResidentCell,
	type TwoHopRowSlotFrame,
} from "./twoHopCellBinding";
import type { TwoHopViewPlan } from "./twoHopViewPlan";
import type { TwoHopVirtualListItem } from "./twoHopVirtualListModel";

export interface TwoHopFixedCellSlotController
	extends MountedVirtualCell,
		VirtualCellRegistrationOwner {
	readonly cellSlotKey: number;
	readonly active: boolean;
	readonly logicalKey: LogicalCellKey;
	readonly rowFrame: TwoHopRowSlotFrame | null;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly cell: VirtualListLogicalCell<TwoHopVirtualListItem> | undefined;
	readonly renderBodyKind: "item" | "header" | "load-more";
	readonly binding: TwoHopCellBinding | null;
}

export interface TwoHopFixedRowSlotController
	extends VirtualSurfaceMountedRow<TwoHopFixedCellSlotController> {
	readonly slotIndex: number;
	readonly active: boolean;
	readonly rowIndex: number;
	readonly top: number;
	readonly frame: TwoHopRowSlotFrame | null;
	readonly cells: readonly TwoHopFixedCellSlotController[];
	readonly bindings: readonly TwoHopCellBinding[];
	readonly cellControllers: readonly TwoHopFixedCellSlotController[];
}

interface MutableTwoHopFixedCellSlotController
	extends TwoHopFixedCellSlotController {
	commitRegistration(
		previousBinding: TwoHopCellBinding | null,
		nextBinding: TwoHopCellBinding | null,
	): void;
	dispose(): void;
}

interface MutableTwoHopFixedRowSlotController
	extends TwoHopFixedRowSlotController {
	setCellCapacity(capacity: number): void;
	commit(frame: TwoHopRowSlotFrame): void;
	clear(): void;
}

export interface TwoHopFixedRowSlotPool {
	readonly controllers: readonly TwoHopFixedRowSlotController[];
	ensureCapacity(capacity: number, cellCapacity?: number): void;
	setCapacity(capacity: number, cellCapacity?: number): void;
	commit(frame: TwoHopRowSlotFrame): void;
	clearSlot(slotIndex: number): void;
}

export interface TwoHopPhysicalSlotPreparation {
	readonly capacity: number;
	readonly poolChanged: boolean;
}

export interface TwoHopPhysicalSlotStore {
	readonly fixedRowSlotPool: TwoHopFixedRowSlotPool;
	readonly mountedRows: readonly TwoHopFixedRowSlotController[];
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
	clearOneOutsideRange(start: number, end: number): boolean;
	hasBoundOutsideRange(start: number, end: number): boolean;
	isRowBound(logicalRowIndex: number): boolean;
	setPreviewRange(start: number, end: number): void;
	getMountedCellByInteractionId(
		interactionId: string,
	): TwoHopResidentCell | undefined;
	dispose(): void;
}

const EMPTY_BINDINGS: readonly TwoHopCellBinding[] = [];
const EMPTY_CELL_CONTROLLERS: readonly TwoHopFixedCellSlotController[] = [];

function createCellController(params: {
	readonly cellSlotKey: number;
	readonly columnIndex: number;
	readFrame(): TwoHopRowSlotFrame | null;
}): MutableTwoHopFixedCellSlotController {
	let cellElement: HTMLElement | null = null;
	let cellRegistry: VirtualCellRegistry | null = null;
	let cellRegistration: VirtualCellElementRegistration | null = null;

	function readBinding(): TwoHopCellBinding | null {
		return params.readFrame()?.cells[params.columnIndex] ?? null;
	}

	function unregister(): void {
		cellRegistration?.unregister();
		cellRegistration = null;
	}

	function register(binding: TwoHopCellBinding | null): void {
		if (!binding || !cellElement || !cellRegistry) return;
		cellRegistration ??= cellRegistry.createRegistration(cellElement);
		cellRegistration.update(
			String(binding.compiledCell.logicalKey),
			binding.logicalRowIndex,
			binding.columnIndex,
		);
	}

	return {
		cellSlotKey: params.cellSlotKey,
		renderSlotKey: renderSlotKey(params.cellSlotKey),
		renderSlotIndex: params.cellSlotKey,
		get active() {
			return readBinding() !== null;
		},
		get key() {
			return readBinding()?.compiledCell.logicalKey ?? logicalCellKey("");
		},
		get logicalKey() {
			return readBinding()?.compiledCell.logicalKey ?? logicalCellKey("");
		},
		get rowFrame() {
			return params.readFrame();
		},
		get rowIndex() {
			return readBinding()?.logicalRowIndex ?? -1;
		},
		get columnIndex() {
			return params.columnIndex;
		},
		get cell() {
			return readBinding()?.compiledCell.logicalCell;
		},
		get renderBodyKind() {
			return readBinding()?.compiledCell.renderBodyKind ?? "header";
		},
		get binding() {
			return readBinding();
		},
		commitRegistration(previousBinding, nextBinding): void {
			const previousKey = previousBinding?.compiledCell.logicalKey;
			const nextKey = nextBinding?.compiledCell.logicalKey;
			if (previousKey !== undefined && previousKey !== nextKey && cellElement) {
				dispatchVirtualCellWillRebind(cellElement, {
					previousLogicalKey: String(previousKey),
					nextLogicalKey: nextKey === undefined ? "" : String(nextKey),
				});
			}
			if (!nextBinding) {
				unregister();
				return;
			}
			register(nextBinding);
		},
		attachElement(element, registry): void {
			if (cellElement === element && cellRegistry === registry) return;
			unregister();
			cellElement = element;
			cellRegistry = registry;
			register(readBinding());
		},
		detachElement(element): void {
			if (cellElement !== element) return;
			unregister();
			cellElement = null;
			cellRegistry = null;
		},
		dispose(): void {
			unregister();
			cellElement = null;
			cellRegistry = null;
		},
	};
}

function createRowController(
	slotIndex: number,
): MutableTwoHopFixedRowSlotController {
	let frame = $state.raw<TwoHopRowSlotFrame | null>(null);
	let cellControllers = $state.raw<
		readonly MutableTwoHopFixedCellSlotController[]
	>([]);

	function setCellCapacity(capacity: number): void {
		if (cellControllers.length === capacity) return;
		if (frame) clear();
		for (const controller of cellControllers) controller.dispose();
		const next: MutableTwoHopFixedCellSlotController[] = [];
		for (let columnIndex = 0; columnIndex < capacity; columnIndex += 1) {
			next.push(
				createCellController({
					cellSlotKey: slotIndex * capacity + columnIndex,
					columnIndex,
					readFrame: () => frame,
				}),
			);
		}
		cellControllers = next;
	}

	function commit(nextFrame: TwoHopRowSlotFrame): void {
		setCellCapacity(Math.max(cellControllers.length, nextFrame.cells.length));
		const previousFrame = frame;
		for (let index = 0; index < cellControllers.length; index += 1) {
			const previousBinding = previousFrame?.cells[index] ?? null;
			const nextBinding = nextFrame.cells[index] ?? null;
			const previousKey = previousBinding?.compiledCell.logicalKey;
			const nextKey = nextBinding?.compiledCell.logicalKey;
			if (previousKey !== nextKey && process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.reboundCellSlot");
			}
			if (previousKey !== nextKey) {
				cellControllers[index]?.commitRegistration(
					previousBinding,
					nextBinding,
				);
			}
		}
		frame = nextFrame;
		for (let index = 0; index < cellControllers.length; index += 1) {
			const previousBinding = previousFrame?.cells[index] ?? null;
			const nextBinding = nextFrame.cells[index] ?? null;
			if (
				previousBinding?.compiledCell.logicalKey ===
				nextBinding?.compiledCell.logicalKey
			) {
				cellControllers[index]?.commitRegistration(
					previousBinding,
					nextBinding,
				);
			}
		}
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("twoHop.reboundRowSlot");
			recordCCLDevMeasurement("twoHop.rowFrame.commit");
			for (const _binding of nextFrame.cells) {
				recordCCLDevMeasurement("twoHop.binding.commit");
			}
		}
	}

	function clear(): void {
		const previousFrame = frame;
		if (!previousFrame) return;
		for (let index = 0; index < cellControllers.length; index += 1) {
			cellControllers[index]?.commitRegistration(
				previousFrame.cells[index] ?? null,
				null,
			);
		}
		frame = null;
	}

	return {
		key: slotIndex,
		slotIndex,
		slotKey: slotIndex,
		get active() {
			return frame !== null;
		},
		get rowIndex() {
			return frame?.logicalRowIndex ?? -1;
		},
		get top() {
			return frame?.top ?? 0;
		},
		get frame() {
			return frame;
		},
		get cells() {
			return frame
				? cellControllers.slice(0, frame.cells.length)
				: EMPTY_CELL_CONTROLLERS;
		},
		get bindings() {
			return frame?.cells ?? EMPTY_BINDINGS;
		},
		get cellControllers() {
			return cellControllers;
		},
		setCellCapacity,
		commit,
		clear,
	};
}

export function createTwoHopFixedRowSlotPool(): TwoHopFixedRowSlotPool {
	let controllers = $state.raw<readonly MutableTwoHopFixedRowSlotController[]>([]);
	let configuredCellCapacity = 0;

	function ensureCapacity(capacity: number, cellCapacity?: number): void {
		if (cellCapacity !== undefined && cellCapacity !== configuredCellCapacity) {
			configuredCellCapacity = cellCapacity;
			for (const controller of controllers) {
				controller.setCellCapacity(configuredCellCapacity);
			}
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
		commit(frame): void {
			const controller = controllers[frame.slotIndex];
			if (controller) {
				controller.commit(frame);
				return;
			}
			ensureCapacity(frame.slotIndex + 1);
			controllers[frame.slotIndex]?.commit(frame);
		},
		clearSlot(slotIndex): void {
			controllers[slotIndex]?.clear();
		},
	};
}

/** Owns the physical row frames and their logical-to-physical index. */
export function createTwoHopPhysicalSlotStore(params: {
	readonly rowPreviewActivationRuntime?: RowPreviewActivationRuntime;
}): TwoHopPhysicalSlotStore {
	const fixedRowSlotPool = createTwoHopFixedRowSlotPool();
	const rowSlotAllocator = createResidentRowSlotAllocator();
	const mountedCellsByInteractionId = new Map<string, TwoHopResidentCell>();
	let activeColumns = 0;
	let activePoolEpoch = -1;
	let previewStart = 0;
	let previewEnd = 0;
	const preparation: { capacity: number; poolChanged: boolean } = {
		capacity: 0,
		poolChanged: false,
	};

	function indexFrame(frame: TwoHopRowSlotFrame): void {
		for (const binding of frame.cells) {
			const interactionId = binding.compiledCell.interactionId;
			if (interactionId) {
				mountedCellsByInteractionId.set(interactionId, { binding, rowFrame: frame });
			}
		}
	}

	function unindexFrame(frame: TwoHopRowSlotFrame): void {
		for (const binding of frame.cells) {
			const interactionId = binding.compiledCell.interactionId;
			if (
				interactionId &&
				mountedCellsByInteractionId.get(interactionId)?.binding === binding
			) {
				mountedCellsByInteractionId.delete(interactionId);
			}
		}
	}

	function clearController(controller: TwoHopFixedRowSlotController): void {
		const frame = controller.frame;
		if (!frame) return;
		params.rowPreviewActivationRuntime?.clearRow(frame.logicalRowIndex);
		unindexFrame(frame);
		fixedRowSlotPool.clearSlot(controller.slotIndex);
	}

	function ensurePool(columns: number, capacity: number): void {
		const resized =
			activeColumns !== columns ||
			fixedRowSlotPool.controllers.length !== capacity;
		if (resized && process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("twoHop.physicalPool.resize");
		}
		if (activeColumns !== columns) {
			for (const controller of fixedRowSlotPool.controllers) {
				clearController(controller);
			}
			activeColumns = columns;
		}
		fixedRowSlotPool.setCapacity(capacity, columns);
	}

	function resolveVisibility(rowIndex: number): VirtualizedItemVisibility {
		return rowIndex >= previewStart && rowIndex < previewEnd
			? "visible"
			: "mounted";
	}

	function setRowVisibility(controller: TwoHopFixedRowSlotController): void {
		if (!controller.frame) return;
		params.rowPreviewActivationRuntime?.setRowVisibility(
			controller.frame.logicalRowIndex,
			resolveVisibility(controller.frame.logicalRowIndex),
		);
	}

	function setLogicalRowVisibility(rowIndex: number): void {
		if (rowSlotAllocator.capacity === 0) return;
		const slotIndex = rowSlotAllocator.resolveSlotIndex(rowIndex);
		const controller = fixedRowSlotPool.controllers[slotIndex];
		if (!controller?.frame || controller.frame.logicalRowIndex !== rowIndex) return;
		setRowVisibility(controller);
	}

	return {
		fixedRowSlotPool,
		get mountedRows() {
			return fixedRowSlotPool.controllers;
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
			const controller = fixedRowSlotPool.controllers[slotIndex];
			if (!controller) return;
			const previousFrame = controller.frame;
			if (
				previousFrame &&
				previousFrame.logicalRowIndex !== logicalRowIndex
			) {
				params.rowPreviewActivationRuntime?.clearRow(
					previousFrame.logicalRowIndex,
				);
			}
			if (previousFrame) unindexFrame(previousFrame);
			const sectionPlan = plan.sections[plan.rowSectionIndex[logicalRowIndex]];
			if (!sectionPlan) {
				clearController(controller);
				return;
			}
			const cellCount = plan.rowCellCount[logicalRowIndex];
			const cells: TwoHopCellBinding[] = [];
			for (let columnIndex = 0; columnIndex < cellCount; columnIndex += 1) {
				const compiledCell =
					plan.cells[plan.rowFirstCellIndex[logicalRowIndex] + columnIndex];
				if (!compiledCell) {
					clearController(controller);
					return;
				}
				cells.push(
					createTwoHopCellBinding({
						compiledCell,
						logicalRowIndex,
						columnIndex,
						epoch:
							(previousFrame?.cells[columnIndex]?.epoch ?? -1) + 1,
					}),
				);
			}
			const frame: TwoHopRowSlotFrame = {
				epoch: (previousFrame?.epoch ?? -1) + 1,
				slotIndex,
				logicalRowIndex,
				top: plan.rowTop[logicalRowIndex],
				sectionPlan,
				cells,
			};
			fixedRowSlotPool.commit(frame);
			indexFrame(frame);
			setRowVisibility(controller);
		},
		clearRow(logicalRowIndex): void {
			if (rowSlotAllocator.capacity === 0) return;
			const slotIndex = rowSlotAllocator.resolveSlotIndex(logicalRowIndex);
			const controller = fixedRowSlotPool.controllers[slotIndex];
			if (controller?.frame?.logicalRowIndex === logicalRowIndex) {
				clearController(controller);
			}
		},
		clearAll(): void {
			for (const controller of fixedRowSlotPool.controllers) {
				clearController(controller);
			}
		},
		clearOutsideRange(start, end): void {
			for (const controller of fixedRowSlotPool.controllers) {
				const rowIndex = controller.frame?.logicalRowIndex;
				if (rowIndex !== undefined && (rowIndex < start || rowIndex >= end)) {
					clearController(controller);
				}
			}
		},
		clearOneOutsideRange(start, end): boolean {
			for (const controller of fixedRowSlotPool.controllers) {
				const rowIndex = controller.frame?.logicalRowIndex;
				if (rowIndex === undefined || (rowIndex >= start && rowIndex < end)) {
					continue;
				}
				clearController(controller);
				return true;
			}
			return false;
		},
		hasBoundOutsideRange(start, end): boolean {
			for (const controller of fixedRowSlotPool.controllers) {
				const rowIndex = controller.frame?.logicalRowIndex;
				if (rowIndex !== undefined && (rowIndex < start || rowIndex >= end)) {
					return true;
				}
			}
			return false;
		},
		isRowBound(logicalRowIndex): boolean {
			if (rowSlotAllocator.capacity === 0) return false;
			const slotIndex = rowSlotAllocator.resolveSlotIndex(logicalRowIndex);
			return (
				fixedRowSlotPool.controllers[slotIndex]?.frame?.logicalRowIndex ===
				logicalRowIndex
			);
		},
		setPreviewRange(start, end): void {
			if (previewStart === start && previewEnd === end) return;
			const previousStart = previewStart;
			const previousEnd = previewEnd;
			previewStart = start;
			previewEnd = end;
			if (previousStart < start) {
				for (let row = previousStart; row < Math.min(previousEnd, start); row += 1) {
					setLogicalRowVisibility(row);
				}
			}
			if (end < previousEnd) {
				for (let row = Math.max(previousStart, end); row < previousEnd; row += 1) {
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
		getMountedCellByInteractionId(interactionId) {
			return mountedCellsByInteractionId.get(interactionId);
		},
		dispose(): void {
			for (const controller of fixedRowSlotPool.controllers) {
				clearController(controller);
			}
			mountedCellsByInteractionId.clear();
			rowSlotAllocator.dispose();
		},
	};
}
