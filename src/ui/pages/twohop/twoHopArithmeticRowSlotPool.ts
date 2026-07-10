type TwoHopRowSlotResetReason = "layout" | "empty";

export interface TwoHopArithmeticRowSlotPool {
	prepareRange(start: number, end: number, layoutKey: unknown): void;
	resolveSlotIndex(logicalRowIndex: number): number;
	reset(reason: TwoHopRowSlotResetReason): void;
	dispose(): void;
	readonly capacity: number;
	readonly epoch: number;
}

/**
 * Creates a zero-allocation slot pool for a contiguous integer row range.
 * Capacity changes start a new epoch because modulo slot identities depend on
 * the divisor.
 */
export function createTwoHopArithmeticRowSlotPool(): TwoHopArithmeticRowSlotPool {
	let capacity = 0;
	let epoch = 0;
	let layoutKey: unknown;
	let hasLayoutKey = false;
	let disposed = false;
	let underutilizedPrepareCount = 0;

	function reset(_reason: TwoHopRowSlotResetReason): void {
		capacity = 0;
		layoutKey = undefined;
		hasLayoutKey = false;
		underutilizedPrepareCount = 0;
		epoch += 1;
	}

	function prepareRange(start: number, end: number, nextLayoutKey: unknown): void {
		if (disposed) return;
		let resetDuringPrepare = false;
		if (hasLayoutKey && !Object.is(layoutKey, nextLayoutKey)) {
			reset("layout");
			resetDuringPrepare = true;
		}
		layoutKey = nextLayoutKey;
		hasLayoutKey = true;
		const activeRows = Math.max(0, end - start);
		const previousCapacity = capacity;
		let nextCapacity = capacity;
		if (activeRows > capacity) {
			nextCapacity = activeRows;
			underutilizedPrepareCount = 0;
		} else if (activeRows > 0 && activeRows * 4 <= capacity) {
			underutilizedPrepareCount += 1;
			if (underutilizedPrepareCount >= 3) {
				nextCapacity = activeRows;
				underutilizedPrepareCount = 0;
			}
		} else {
			underutilizedPrepareCount = 0;
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
