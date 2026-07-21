import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
	type ResidentSlotResetReason,
} from "ui/virtualization/core/residentSlotAllocator";

/** Creates the stateful physical row-slot pool used by the two-hop surface. */
export function createTwoHopResidentRowSlotAllocator(): ResidentRowSlotAllocator {
	const capacityAllocator = createResidentRowSlotAllocator();
	const slotByLogicalRow = new Map<number, number>();
	const logicalRowBySlot: Array<number | undefined> = [];
	let layoutKey: unknown;
	let hasLayoutKey = false;
	let disposed = false;

	function prepareRange(params: {
		readonly start: number;
		readonly end: number;
		readonly layoutKey: unknown;
	}): void {
		if (disposed) return;
		if (hasLayoutKey && !Object.is(layoutKey, params.layoutKey)) {
			clearAssignments();
		}
		layoutKey = params.layoutKey;
		hasLayoutKey = true;

		capacityAllocator.prepareRange(params);
		logicalRowBySlot.length = capacityAllocator.capacity;
		const rangeStart = params.start;
		const rangeEnd = Math.max(rangeStart, params.end);
		const releasedSlots = releaseRowsOutsideRange(rangeStart, rangeEnd);
		assignEnteringRows(rangeStart, rangeEnd, releasedSlots);
	}

	function releaseRowsOutsideRange(rangeStart: number, rangeEnd: number): number[] {
		const releasedSlots: number[] = [];
		for (const [logicalRowIndex, slotIndex] of slotByLogicalRow) {
			if (logicalRowIndex >= rangeStart && logicalRowIndex < rangeEnd) continue;
			slotByLogicalRow.delete(logicalRowIndex);
			logicalRowBySlot[slotIndex] = undefined;
			releasedSlots.push(slotIndex);
		}
		releasedSlots.sort((left, right) => left - right);
		return releasedSlots;
	}

	function assignEnteringRows(
		rangeStart: number,
		rangeEnd: number,
		releasedSlots: readonly number[],
	): void {
		let releasedSlotOffset = 0;
		let nextFreeSlotIndex = 0;
		for (
			let logicalRowIndex = rangeStart;
			logicalRowIndex < rangeEnd;
			logicalRowIndex += 1
		) {
			if (slotByLogicalRow.has(logicalRowIndex)) continue;

			let slotIndex = releasedSlots[releasedSlotOffset];
			if (slotIndex !== undefined) {
				releasedSlotOffset += 1;
			} else {
				while (
					nextFreeSlotIndex < capacityAllocator.capacity &&
					logicalRowBySlot[nextFreeSlotIndex] !== undefined
				) {
					nextFreeSlotIndex += 1;
				}
				if (nextFreeSlotIndex >= capacityAllocator.capacity) return;
				slotIndex = nextFreeSlotIndex;
				nextFreeSlotIndex += 1;
			}

			slotByLogicalRow.set(logicalRowIndex, slotIndex);
			logicalRowBySlot[slotIndex] = logicalRowIndex;
		}
	}

	function resolveSlotIndex(logicalRowIndex: number): number {
		return slotByLogicalRow.get(logicalRowIndex) ?? 0;
	}

	function clearAssignments(): void {
		slotByLogicalRow.clear();
		logicalRowBySlot.length = 0;
	}

	function reset(reason: ResidentSlotResetReason): void {
		clearAssignments();
		layoutKey = undefined;
		hasLayoutKey = false;
		capacityAllocator.reset(reason);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		clearAssignments();
		capacityAllocator.dispose();
	}

	return {
		prepareRange,
		resolveSlotIndex,
		reset,
		dispose,
		get capacity() {
			return capacityAllocator.capacity;
		},
		get epoch() {
			return capacityAllocator.epoch;
		},
	};
}
