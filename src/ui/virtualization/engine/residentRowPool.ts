import {
	recordCCLDevMeasurement,
	recordCCLDevMeasurementCount,
} from "infrastructure/debug/CCLDevMeasurements";

export interface ResidentRowSlotRange {
	readonly start: number;
	readonly end: number;
	/**
	 * Revision of the mapping between a logical row and its physical cell slots.
	 *
	 * Grid consumers use their column count. Pure geometry changes such as row
	 * height, gap, or cell width must not change this revision.
	 */
	readonly slotTopologyRevision: number;
}

export interface ResidentRowSlotAllocator {
	/** Reconciles a bounded physical slot pool with a contiguous integer row range. */
	prepareRange(params: ResidentRowSlotRange): void;
	resolveSlotIndex(logicalRowIndex: number): number | undefined;
	reset(): void;
	dispose(): void;
	readonly capacity: number;
}

/** Creates the authoritative free-list slot lifecycle used by resident row windows. */
export function createResidentRowSlotAllocator(): ResidentRowSlotAllocator {
	let capacity = 0;
	let slotTopologyRevision = 0;
	let hasSlotTopologyRevision = false;
	let activeStart = 0;
	let activeEnd = 0;
	let hasActiveRange = false;
	let disposed = false;
	const logicalRowToSlot = new Map<number, number>();
	const freeSlotIndices = new Set<number>();
	// Reused across range shifts so prepareRange stays allocation-free.
	const leavingSlotIndicesScratch: number[] = [];

	function assertUsable(): void {
		if (disposed) {
			throw new Error("Resident row slot allocator has been disposed");
		}
	}

	function reset(): void {
		assertUsable();
		capacity = 0;
		slotTopologyRevision = 0;
		hasSlotTopologyRevision = false;
		activeStart = 0;
		activeEnd = 0;
		hasActiveRange = false;
		logicalRowToSlot.clear();
		freeSlotIndices.clear();
	}

	function prepareRange(params: ResidentRowSlotRange): void {
		assertUsable();
		recordCCLDevMeasurement("virtualGrid.contiguousSlotPool.apply");

		const start = Math.max(0, Math.floor(params.start));
		const end = Math.max(start, Math.floor(params.end));
		if (
			hasSlotTopologyRevision &&
			Object.is(slotTopologyRevision, params.slotTopologyRevision) &&
			hasActiveRange &&
			activeStart === start &&
			activeEnd === end
		) {
			recordCCLDevMeasurement("virtualGrid.residentSlotPool.rangeHit");
			return;
		}

		if (
			hasSlotTopologyRevision &&
			!Object.is(slotTopologyRevision, params.slotTopologyRevision)
		) {
			reset();
		}
		slotTopologyRevision = params.slotTopologyRevision;
		hasSlotTopologyRevision = true;

		const leavingSlotIndices = leavingSlotIndicesScratch;
		leavingSlotIndices.length = 0;
		for (const [logicalRowIndex, physicalRowSlot] of logicalRowToSlot) {
			if (logicalRowIndex >= start && logicalRowIndex < end) continue;
			logicalRowToSlot.delete(logicalRowIndex);
			leavingSlotIndices.push(physicalRowSlot);
		}

		let changedSlotCount = 0;
		let leavingOffset = 0;
		for (let logicalRowIndex = start; logicalRowIndex < end; logicalRowIndex += 1) {
			if (logicalRowToSlot.has(logicalRowIndex)) continue;

			const reboundSlotIndex = leavingSlotIndices[leavingOffset];
			if (reboundSlotIndex !== undefined) leavingOffset += 1;
			const previouslyFreeSlotIndex =
				reboundSlotIndex === undefined
					? freeSlotIndices.values().next().value
					: undefined;
			const physicalRowSlot =
				reboundSlotIndex ?? previouslyFreeSlotIndex ?? allocateSlot();
			if (previouslyFreeSlotIndex !== undefined) {
				freeSlotIndices.delete(previouslyFreeSlotIndex);
			}
			logicalRowToSlot.set(logicalRowIndex, physicalRowSlot);
			changedSlotCount += 1;
		}

		for (let index = leavingOffset; index < leavingSlotIndices.length; index += 1) {
			freeSlotIndices.add(leavingSlotIndices[index]!);
			changedSlotCount += 1;
		}

		activeStart = start;
		activeEnd = end;
		hasActiveRange = true;
		recordCCLDevMeasurementCount(
			"virtualGrid.residentSlotPool.changedSlots",
			changedSlotCount,
		);
	}

	function allocateSlot(): number {
		const physicalRowSlot = capacity;
		capacity += 1;
		return physicalRowSlot;
	}

	function resolveSlotIndex(logicalRowIndex: number): number | undefined {
		assertUsable();
		return logicalRowToSlot.get(logicalRowIndex);
	}

	function dispose(): void {
		if (disposed) return;
		reset();
		disposed = true;
	}

	return {
		prepareRange,
		resolveSlotIndex,
		reset,
		dispose,
		get capacity() {
			return capacity;
		},
	};
}
