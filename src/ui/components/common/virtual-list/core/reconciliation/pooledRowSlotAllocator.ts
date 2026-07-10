export type PooledRowKey = string | number;

export type PooledRowSlotResetReason = "empty" | "layout" | "source";

export interface PooledRowSlotAllocation {
	readonly slotIndexes: readonly number[];
	readonly capacity: number;
	readonly epoch: number;
}

export interface PooledRowSlotAllocator {
	/**
	 * Reconciles the active logical rows against a persistent, bounded slot pool.
	 * Retained rows keep their slot and entering rows consume released slots
	 * before the pool grows.
	 */
	apply(params: {
		readonly rowKeys: readonly PooledRowKey[];
		readonly layoutKey: unknown;
		readonly sourceKey?: unknown;
	}): PooledRowSlotAllocation;

	reset(reason: PooledRowSlotResetReason): void;
	dispose(): void;
	readonly capacity: number;
	readonly epoch: number;
}

/** Creates a persistent row-slot allocator for one virtual-list engine. */
export function createPooledRowSlotAllocator(): PooledRowSlotAllocator {
	const slotByRowKey = new Map<PooledRowKey, number>();
	const rowKeyBySlot: Array<PooledRowKey | null> = [];
	const freeSlots: number[] = [];
	let layoutKey: unknown;
	let sourceKey: unknown;
	let hasLayoutKey = false;
	let hasSourceKey = false;
	let epoch = 0;
	let disposed = false;
	let underutilizedApplyCount = 0;

	function clearPool(): void {
		slotByRowKey.clear();
		rowKeyBySlot.length = 0;
		freeSlots.length = 0;
		underutilizedApplyCount = 0;
		epoch += 1;
	}

	function reset(_reason: PooledRowSlotResetReason): void {
		clearPool();
		hasLayoutKey = false;
		hasSourceKey = false;
		layoutKey = undefined;
		sourceKey = undefined;
	}

	function releaseInactiveRows(nextRowKeys: ReadonlySet<PooledRowKey>): void {
		for (const [rowKey, slotIndex] of slotByRowKey) {
			if (nextRowKeys.has(rowKey)) continue;
			slotByRowKey.delete(rowKey);
			rowKeyBySlot[slotIndex] = null;
			freeSlots.push(slotIndex);
		}

		// Descending order lets pop() return the lowest free slot. Sorting only
		// released slots keeps allocation deterministic without sorting rows.
		freeSlots.sort((left, right) => right - left);
	}

	function allocateSlot(rowKey: PooledRowKey): number {
		const freeSlot = freeSlots.pop();
		const slotIndex = freeSlot ?? rowKeyBySlot.length;
		rowKeyBySlot[slotIndex] = rowKey;
		slotByRowKey.set(rowKey, slotIndex);
		return slotIndex;
	}

	function apply(params: {
		readonly rowKeys: readonly PooledRowKey[];
		readonly layoutKey: unknown;
		readonly sourceKey?: unknown;
	}): PooledRowSlotAllocation {
		if (disposed) {
			return { slotIndexes: [], capacity: 0, epoch };
		}

		const layoutChanged = hasLayoutKey && !Object.is(layoutKey, params.layoutKey);
		const hasNextSourceKey = "sourceKey" in params;
		const sourceChanged =
			hasSourceKey &&
			hasNextSourceKey &&
			!Object.is(sourceKey, params.sourceKey);
		if (layoutChanged || sourceChanged) {
			clearPool();
		}

		layoutKey = params.layoutKey;
		hasLayoutKey = true;
		if (hasNextSourceKey) {
			sourceKey = params.sourceKey;
			hasSourceKey = true;
		}

		const nextRowKeys = new Set(params.rowKeys);
		releaseInactiveRows(nextRowKeys);
		if (
			params.rowKeys.length > 0 &&
			params.rowKeys.length * 4 <= rowKeyBySlot.length
		) {
			underutilizedApplyCount += 1;
		} else {
			underutilizedApplyCount = 0;
		}
		// Do not compact for a transient resize. Sustained 75% under-utilization
		// starts a new epoch so historical peak capacity is eventually released.
		if (underutilizedApplyCount >= 3) {
			clearPool();
		}

		const slotIndexes = new Array<number>(params.rowKeys.length);
		for (let index = 0; index < params.rowKeys.length; index += 1) {
			const rowKey = params.rowKeys[index];
			slotIndexes[index] = slotByRowKey.get(rowKey) ?? allocateSlot(rowKey);
		}

		return {
			slotIndexes,
			capacity: rowKeyBySlot.length,
			epoch,
		};
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		reset("empty");
	}

	return {
		apply,
		reset,
		dispose,
		get capacity() {
			return rowKeyBySlot.length;
		},
		get epoch() {
			return epoch;
		},
	};
}
