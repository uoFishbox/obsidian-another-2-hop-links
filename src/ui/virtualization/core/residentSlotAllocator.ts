import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type { ResidentSlotLeaseToken, ResidentSlotPoolId } from "./residentSlotBinding";

export type ResidentSlotResetReason = "empty" | "layout" | "source";

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

export interface ResidentRowSlotAllocator {
	/** Reconciles a bounded physical slot pool with a contiguous integer row range. */
	prepareRange(params: {
		readonly start: number;
		readonly end: number;
		readonly layoutRevision: unknown;
	}): ResidentSlotPoolPublication;
	resolveSlotIndex(logicalRowIndex: number): number;
	resolveSlotLease(logicalRowIndex: number): ResidentSlotLeaseToken | undefined;
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
	let layoutRevision: unknown;
	let hasLayoutRevision = false;
	let activeStart = 0;
	let activeEnd = 0;
	let hasActiveRange = false;
	let disposed = false;
	const logicalRowToSlot = new Map<number, number>();
	const slotToLogicalRow: Array<number | undefined> = [];
	const slotGenerations: number[] = [];
	const leasesBySlot: Array<ResidentSlotLeaseToken | undefined> = [];
	const freeSlotIndices = new Set<number>();
	let publication = createPublication();

	function reset(_reason: ResidentSlotResetReason): void {
		capacity = 0;
		layoutRevision = undefined;
		hasLayoutRevision = false;
		activeStart = 0;
		activeEnd = 0;
		hasActiveRange = false;
		logicalRowToSlot.clear();
		slotToLogicalRow.length = 0;
		slotGenerations.length = 0;
		leasesBySlot.length = 0;
		freeSlotIndices.clear();
		epoch += 1;
		revision += 1;
		publication = createPublication();
	}

	function prepareRange(params: {
		readonly start: number;
		readonly end: number;
		readonly layoutRevision: unknown;
	}): ResidentSlotPoolPublication {
		if (disposed) return publication;
		recordCCLDevMeasurement("virtualGrid.contiguousSlotPool.apply");

		const start = Math.max(0, Math.floor(params.start));
		const end = Math.max(start, Math.floor(params.end));
		if (
			hasLayoutRevision &&
			Object.is(layoutRevision, params.layoutRevision) &&
			hasActiveRange &&
			activeStart === start &&
			activeEnd === end
		) {
			recordCCLDevMeasurement("virtualGrid.residentSlotPool.rangeHit");
			return publication;
		}

		if (hasLayoutRevision && !Object.is(layoutRevision, params.layoutRevision)) {
			reset("layout");
		}
		layoutRevision = params.layoutRevision;
		hasLayoutRevision = true;

		const leavingSlotIndices: number[] = [];
		for (const [logicalRowIndex, slotIndex] of logicalRowToSlot) {
			if (logicalRowIndex >= start && logicalRowIndex < end) continue;
			logicalRowToSlot.delete(logicalRowIndex);
			slotToLogicalRow[slotIndex] = undefined;
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
		for (let index = 0; index < changedSlotCount; index += 1) {
			recordCCLDevMeasurement("virtualGrid.residentSlotPool.changedSlots");
		}
		return publication;
	}

	function allocateSlot(): number {
		const slotIndex = capacity;
		capacity += 1;
		slotToLogicalRow.push(undefined);
		slotGenerations.push(0);
		leasesBySlot.push(undefined);
		return slotIndex;
	}

	function resolveSlotIndex(logicalRowIndex: number): number {
		return logicalRowToSlot.get(logicalRowIndex) ?? 0;
	}

	function resolveSlotLease(
		logicalRowIndex: number,
	): ResidentSlotLeaseToken | undefined {
		const slotIndex = logicalRowToSlot.get(logicalRowIndex);
		return slotIndex === undefined ? undefined : leasesBySlot[slotIndex];
	}

	function assignSlot(slotIndex: number, logicalRowIndex: number): void {
		const slotGeneration = (slotGenerations[slotIndex] ?? 0) + 1;
		slotGenerations[slotIndex] = slotGeneration;
		leasesBySlot[slotIndex] = Object.freeze({
			poolId,
			poolEpoch: epoch,
			slotIndex,
			slotGeneration,
		});
		slotToLogicalRow[slotIndex] = logicalRowIndex;
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
		disposed = true;
		reset("empty");
	}

	return {
		prepareRange,
		resolveSlotIndex,
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
