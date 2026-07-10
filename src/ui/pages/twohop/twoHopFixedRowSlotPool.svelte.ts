import type { TwoHopMountedRowSlice } from "./twoHopMountedTypes";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

export interface TwoHopFixedRowSlotController {
	readonly slotIndex: number;
	readonly row: TwoHopMountedRowSlice | null;
	bindRow(row: TwoHopMountedRowSlice): void;
	clear(): void;
}

export interface TwoHopFixedRowSlotPool {
	readonly controllers: readonly TwoHopFixedRowSlotController[];
	ensureCapacity(capacity: number): void;
	bindRow(row: TwoHopMountedRowSlice): void;
	clearSlot(slotIndex: number): void;
}

function createController(slotIndex: number): TwoHopFixedRowSlotController {
	let row = $state.raw<TwoHopMountedRowSlice | null>(null);
	let revision = $state(0);
	return {
		slotIndex,
		get row() {
			void revision;
			return row;
		},
		bindRow(nextRow): void {
			recordCCLDevMeasurement("twoHop.reboundRowSlot");
			for (const _cell of nextRow.cells) {
				recordCCLDevMeasurement("twoHop.reboundCellSlot");
			}
			row = nextRow;
			revision += 1;
		},
		clear(): void {
			if (row === null) return;
			row = null;
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

	return {
		get controllers() {
			return controllers;
		},
		ensureCapacity,
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
