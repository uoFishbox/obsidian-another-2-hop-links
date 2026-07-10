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
 * The capacity only grows within one layout epoch, so modulo slot identities
 * remain collision-free for every mounted range.
 */
export function createTwoHopArithmeticRowSlotPool(): TwoHopArithmeticRowSlotPool {
	let capacity = 0;
	let epoch = 0;
	let layoutKey: unknown;
	let hasLayoutKey = false;
	let disposed = false;

	function reset(_reason: TwoHopRowSlotResetReason): void {
		capacity = 0;
		layoutKey = undefined;
		hasLayoutKey = false;
		epoch += 1;
	}

	function prepareRange(start: number, end: number, nextLayoutKey: unknown): void {
		if (disposed) return;
		if (hasLayoutKey && !Object.is(layoutKey, nextLayoutKey)) {
			reset("layout");
		}
		layoutKey = nextLayoutKey;
		hasLayoutKey = true;
		capacity = Math.max(capacity, Math.max(0, end - start));
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
