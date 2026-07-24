import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
	type ResidentSlotResetReason,
} from "ui/virtualization/core/residentSlotAllocator";

export interface TwoHopResidentRowSlotBinding {
	readonly slotIndex: number;
	readonly logicalRowIndex: number;
}

export interface TwoHopReboundRowSlot {
	readonly slotIndex: number;
	readonly previousLogicalRowIndex: number;
	readonly logicalRowIndex: number;
}

/** Describes the physical row slots changed by one allocator update. */
export interface TwoHopResidentRowSlotDelta {
	readonly enteredSlots: readonly TwoHopResidentRowSlotBinding[];
	readonly reboundSlots: readonly TwoHopReboundRowSlot[];
	readonly releasedSlots: readonly TwoHopResidentRowSlotBinding[];
}

export interface TwoHopResidentRowSlotAllocator extends ResidentRowSlotAllocator {
	prepareRange(params: {
		readonly start: number;
		readonly end: number;
		readonly layoutKey: unknown;
	}): TwoHopResidentRowSlotDelta;
}

/** Creates the stateful physical row-slot pool used by the two-hop surface. */
export function createTwoHopResidentRowSlotAllocator(): TwoHopResidentRowSlotAllocator {
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
	}): TwoHopResidentRowSlotDelta {
		if (disposed) return createEmptyDelta();
		const releasedBySlot = new Map<number, number>();
		if (hasLayoutKey && !Object.is(layoutKey, params.layoutKey)) {
			for (const [logicalRowIndex, slotIndex] of slotByLogicalRow) {
				releasedBySlot.set(slotIndex, logicalRowIndex);
			}
			clearAssignments();
		}
		layoutKey = params.layoutKey;
		hasLayoutKey = true;

		capacityAllocator.prepareRange(params);
		logicalRowBySlot.length = capacityAllocator.capacity;
		const rangeStart = params.start;
		const rangeEnd = Math.max(rangeStart, params.end);
		const releasedSlots = releaseRowsOutsideRange(rangeStart, rangeEnd);
		for (const binding of releasedSlots) {
			releasedBySlot.set(binding.slotIndex, binding.logicalRowIndex);
		}
		const assignedSlots = assignEnteringRows(
			rangeStart,
			rangeEnd,
			[...releasedBySlot.keys()]
				.filter((slotIndex) => slotIndex < capacityAllocator.capacity)
				.sort((left, right) => left - right),
		);
		const enteredSlots: TwoHopResidentRowSlotBinding[] = [];
		const reboundSlots: TwoHopReboundRowSlot[] = [];
		for (const binding of assignedSlots) {
			const previousLogicalRowIndex = releasedBySlot.get(binding.slotIndex);
			if (previousLogicalRowIndex === undefined) {
				enteredSlots.push(binding);
				continue;
			}
			releasedBySlot.delete(binding.slotIndex);
			reboundSlots.push({
				slotIndex: binding.slotIndex,
				previousLogicalRowIndex,
				logicalRowIndex: binding.logicalRowIndex,
			});
		}

		return {
			enteredSlots,
			reboundSlots,
			releasedSlots: [...releasedBySlot].map(([slotIndex, logicalRowIndex]) => ({
				slotIndex,
				logicalRowIndex,
			})),
		};
	}

	function releaseRowsOutsideRange(
		rangeStart: number,
		rangeEnd: number,
	): TwoHopResidentRowSlotBinding[] {
		const releasedSlots: TwoHopResidentRowSlotBinding[] = [];
		for (const [logicalRowIndex, slotIndex] of slotByLogicalRow) {
			if (logicalRowIndex >= rangeStart && logicalRowIndex < rangeEnd) continue;
			slotByLogicalRow.delete(logicalRowIndex);
			logicalRowBySlot[slotIndex] = undefined;
			releasedSlots.push({ slotIndex, logicalRowIndex });
		}
		return releasedSlots;
	}

	function assignEnteringRows(
		rangeStart: number,
		rangeEnd: number,
		releasedSlots: readonly number[],
	): TwoHopResidentRowSlotBinding[] {
		const assignedSlots: TwoHopResidentRowSlotBinding[] = [];
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
				if (nextFreeSlotIndex >= capacityAllocator.capacity) {
					return assignedSlots;
				}
				slotIndex = nextFreeSlotIndex;
				nextFreeSlotIndex += 1;
			}

			slotByLogicalRow.set(logicalRowIndex, slotIndex);
			logicalRowBySlot[slotIndex] = logicalRowIndex;
			assignedSlots.push({ slotIndex, logicalRowIndex });
		}
		return assignedSlots;
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

function createEmptyDelta(): TwoHopResidentRowSlotDelta {
	return {
		enteredSlots: [],
		reboundSlots: [],
		releasedSlots: [],
	};
}
