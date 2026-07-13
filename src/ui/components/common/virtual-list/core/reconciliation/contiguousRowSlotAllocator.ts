import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

export type RowSlotResetReason = "empty" | "layout" | "source";

export interface ContiguousRowSlotAllocator {
	/**
	 * Prepares a bounded physical slot pool for a contiguous integer row range.
	 * Slot identity is resolved arithmetically by logical row index.
	 */
	prepareRange(params: {
		readonly start: number;
		readonly end: number;
		readonly layoutKey: unknown;
	}): void;
	resolveSlotIndex(logicalRowIndex: number): number;
	reset(reason: RowSlotResetReason): void;
	dispose(): void;
	readonly capacity: number;
	readonly epoch: number;
}

/**
 * Creates an arithmetic slot allocator for contiguous row ranges.
 * Capacity changes start a new epoch because modulo slot identities depend on
 * the divisor.
 */
export function createContiguousRowSlotAllocator(): ContiguousRowSlotAllocator {
	let capacity = 0;
	let epoch = 0;
	let layoutKey: unknown;
	let hasLayoutKey = false;
	let disposed = false;
	let underutilizedApplyCount = 0;

	function reset(_reason: RowSlotResetReason): void {
		capacity = 0;
		layoutKey = undefined;
		hasLayoutKey = false;
		underutilizedApplyCount = 0;
		epoch += 1;
	}

	function prepareRange(params: {
		readonly start: number;
		readonly end: number;
		readonly layoutKey: unknown;
	}): void {
		if (disposed) return;
		recordCCLDevMeasurement("virtualGrid.contiguousSlotPool.apply");

		let resetDuringPrepare = false;
		if (hasLayoutKey && !Object.is(layoutKey, params.layoutKey)) {
			reset("layout");
			resetDuringPrepare = true;
		}

		layoutKey = params.layoutKey;
		hasLayoutKey = true;
		const activeRows = Math.max(0, params.end - params.start);
		const previousCapacity = capacity;
		let nextCapacity = capacity;

		if (activeRows > capacity) {
			nextCapacity = activeRows;
			underutilizedApplyCount = 0;
		} else if (activeRows > 0 && activeRows * 4 <= capacity) {
			underutilizedApplyCount += 1;
			if (underutilizedApplyCount >= 3) {
				nextCapacity = activeRows;
				underutilizedApplyCount = 0;
			}
		} else {
			underutilizedApplyCount = 0;
		}

		if (nextCapacity === capacity) {
			return;
		}

		capacity = nextCapacity;
		if (!resetDuringPrepare && previousCapacity !== 0) {
			epoch += 1;
		}
	}

	function resolveSlotIndex(logicalRowIndex: number): number {
		if (capacity === 0) {
			return 0;
		}

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
