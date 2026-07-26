import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

export type ResidentSlotResetReason = "empty" | "layout" | "source";

export interface ResidentRowSlotAllocator {
	/** Prepares a bounded physical slot pool for a contiguous integer row range. */
	prepareRange(params: {
		readonly start: number;
		readonly end: number;
		readonly layoutRevision: unknown;
	}): void;
	resolveSlotIndex(logicalRowIndex: number): number;
	reset(reason: ResidentSlotResetReason): void;
	dispose(): void;
	readonly capacity: number;
	readonly epoch: number;
}

/** Creates the shared arithmetic slot lifecycle used by resident row windows. */
export function createResidentRowSlotAllocator(): ResidentRowSlotAllocator {
	let capacity = 0;
	let epoch = 0;
	let layoutRevision: unknown;
	let hasLayoutRevision = false;
	let disposed = false;

	function reset(_reason: ResidentSlotResetReason): void {
		capacity = 0;
		layoutRevision = undefined;
		hasLayoutRevision = false;
		epoch += 1;
	}

	function prepareRange(params: {
		readonly start: number;
		readonly end: number;
		readonly layoutRevision: unknown;
	}): void {
		if (disposed) return;
		recordCCLDevMeasurement("virtualGrid.contiguousSlotPool.apply");

		let resetDuringPrepare = false;
		if (hasLayoutRevision && !Object.is(layoutRevision, params.layoutRevision)) {
			reset("layout");
			resetDuringPrepare = true;
		}

		layoutRevision = params.layoutRevision;
		hasLayoutRevision = true;
		const activeRows = Math.max(0, params.end - params.start);
		const previousCapacity = capacity;
		let nextCapacity = capacity;

		if (activeRows > capacity) {
			nextCapacity = activeRows;
		}

		if (nextCapacity === capacity) return;

		capacity = nextCapacity;
		if (!resetDuringPrepare && previousCapacity !== 0) {
			epoch += 1;
		}
	}

	function resolveSlotIndex(logicalRowIndex: number): number {
		if (capacity === 0) return 0;

		const remainder = logicalRowIndex % capacity;
		return remainder < 0 ? remainder + capacity : remainder;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		reset("empty");
	}

	return {
		prepareRange,
		resolveSlotIndex,
		reset,
		dispose,
		get capacity() {
			return capacity;
		},
		get epoch() {
			return epoch;
		},
	};
}
