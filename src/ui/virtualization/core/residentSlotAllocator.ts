import {
	recordCCLDevMeasurement,
	recordCCLDevMeasurementCount,
} from "infrastructure/debug/CCLDevMeasurements";
import {
	rowSlotIndex,
	type ResidentRowSlotLease,
	type ResidentSlotPoolId,
} from "./residentSlotBinding";

export type ResidentSlotResetReason = "empty" | "topology";

/**
 * Lightweight ownership publication used to validate mounted-build reuse.
 *
 * Slot assignments stay private to the allocator; consumers resolve only the
 * lease they need instead of allocating a full immutable delta every frame.
 */
export interface ResidentSlotPoolPublication {
	readonly poolId: ResidentSlotPoolId;
	readonly poolEpoch: number;
	readonly revision: number;
	readonly capacity: number;
}

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
	prepareRange(params: ResidentRowSlotRange): ResidentSlotPoolPublication;
	resolveSlotLease(logicalRowIndex: number): ResidentRowSlotLease | undefined;
	reset(reason: ResidentSlotResetReason): void;
	dispose(): void;
	readonly capacity: number;
	readonly epoch: number;
	readonly publication: ResidentSlotPoolPublication;
}

/** Creates the authoritative free-list slot lifecycle used by resident row windows. */
export function createResidentRowSlotAllocator(): ResidentRowSlotAllocator {
	const poolId = Object.freeze({}) as ResidentSlotPoolId;
	let capacity = 0;
	let epoch = 0;
	let revision = 0;
	let slotTopologyRevision = 0;
	let hasSlotTopologyRevision = false;
	let activeStart = 0;
	let activeEnd = 0;
	let hasActiveRange = false;
	let disposed = false;
	const logicalRowToSlot = new Map<number, number>();
	const slotGenerations: number[] = [];
	const leasesBySlot: Array<ResidentRowSlotLease | undefined> = [];
	const freeSlotIndices = new Set<number>();
	// Reused across range shifts so prepareRange stays allocation-free.
	const leavingSlotIndicesScratch: number[] = [];
	let publication = createPublication();

	function assertUsable(): void {
		if (disposed) {
			throw new Error("Resident row slot allocator has been disposed");
		}
	}

	function reset(_reason: ResidentSlotResetReason): void {
		assertUsable();
		capacity = 0;
		slotTopologyRevision = 0;
		hasSlotTopologyRevision = false;
		activeStart = 0;
		activeEnd = 0;
		hasActiveRange = false;
		logicalRowToSlot.clear();
		slotGenerations.length = 0;
		leasesBySlot.length = 0;
		freeSlotIndices.clear();
		epoch += 1;
		revision += 1;
		publication = createPublication();
	}

	function prepareRange(params: ResidentRowSlotRange): ResidentSlotPoolPublication {
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
			return publication;
		}

		if (
			hasSlotTopologyRevision &&
			!Object.is(slotTopologyRevision, params.slotTopologyRevision)
		) {
			reset("topology");
		}
		slotTopologyRevision = params.slotTopologyRevision;
		hasSlotTopologyRevision = true;

		const leavingSlotIndices = leavingSlotIndicesScratch;
		leavingSlotIndices.length = 0;
		for (const [logicalRowIndex, slotIndex] of logicalRowToSlot) {
			if (logicalRowIndex >= start && logicalRowIndex < end) continue;
			logicalRowToSlot.delete(logicalRowIndex);
			leavingSlotIndices.push(slotIndex);
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
			const slotIndex =
				reboundSlotIndex ?? previouslyFreeSlotIndex ?? allocateSlot();
			if (previouslyFreeSlotIndex !== undefined) {
				freeSlotIndices.delete(previouslyFreeSlotIndex);
			}
			assignSlot(slotIndex, logicalRowIndex);
			changedSlotCount += 1;
		}

		for (let index = leavingOffset; index < leavingSlotIndices.length; index += 1) {
			const slotIndex = leavingSlotIndices[index]!;
			invalidateSlot(slotIndex);
			freeSlotIndices.add(slotIndex);
			changedSlotCount += 1;
		}

		activeStart = start;
		activeEnd = end;
		hasActiveRange = true;
		revision += 1;
		publication = createPublication();
		recordCCLDevMeasurementCount(
			"virtualGrid.residentSlotPool.changedSlots",
			changedSlotCount,
		);
		return publication;
	}

	function allocateSlot(): number {
		const slotIndex = capacity;
		capacity += 1;
		slotGenerations.push(0);
		leasesBySlot.push(undefined);
		return slotIndex;
	}

	function resolveSlotLease(
		logicalRowIndex: number,
	): ResidentRowSlotLease | undefined {
		assertUsable();
		const slotIndex = logicalRowToSlot.get(logicalRowIndex);
		return slotIndex === undefined ? undefined : leasesBySlot[slotIndex];
	}

	function assignSlot(slotIndex: number, logicalRowIndex: number): void {
		const slotGeneration = (slotGenerations[slotIndex] ?? 0) + 1;
		slotGenerations[slotIndex] = slotGeneration;
		leasesBySlot[slotIndex] = Object.freeze({
			poolId,
			poolEpoch: epoch,
			rowSlotIndex: rowSlotIndex(slotIndex),
			rowSlotGeneration: slotGeneration,
		});
		logicalRowToSlot.set(logicalRowIndex, slotIndex);
	}

	function invalidateSlot(slotIndex: number): void {
		slotGenerations[slotIndex] = (slotGenerations[slotIndex] ?? 0) + 1;
		leasesBySlot[slotIndex] = undefined;
	}

	function createPublication(): ResidentSlotPoolPublication {
		return Object.freeze({
			poolId,
			poolEpoch: epoch,
			revision,
			capacity,
		});
	}

	function dispose(): void {
		if (disposed) return;
		reset("empty");
		disposed = true;
	}

	return {
		prepareRange,
		resolveSlotLease,
		reset,
		dispose,
		get capacity() {
			return capacity;
		},
		get epoch() {
			return epoch;
		},
		get publication() {
			return publication;
		},
	};
}
