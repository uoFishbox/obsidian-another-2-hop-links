import { describe, expect, it } from "vitest";
import { createResidentRowSlotAllocator } from "../residentSlotAllocator";

describe("createResidentRowSlotAllocator", () => {
	it("uses exactly the mounted row count and reuses the leaving slot", () => {
		const allocator = createResidentRowSlotAllocator();
		const initial = allocator.prepareRange({
			start: 100,
			end: 120,
			slotTopologyRevision: 4,
		});

		expect(allocator.capacity).toBe(20);
		expect(allocator.resolveSlotLease(100)?.rowSlotIndex).toBe(0);
		expect(allocator.resolveSlotLease(119)?.rowSlotIndex).toBe(19);
		const retainedLease = allocator.resolveSlotLease(101);

		const shifted = allocator.prepareRange({
			start: 101,
			end: 121,
			slotTopologyRevision: 4,
		});
		expect(allocator.resolveSlotLease(120)?.rowSlotIndex).toBe(0);
		expect(allocator.resolveSlotLease(101)).toBe(retainedLease);
		expect(allocator.resolveSlotLease(120)?.rowSlotGeneration).toBeGreaterThan(1);
		expect(shifted.revision).toBe(initial.revision + 1);
	});

	it("keeps peak capacity until a slot-topology reset", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 20, slotTopologyRevision: 4 });
		allocator.prepareRange({ start: 10, end: 18, slotTopologyRevision: 4 });
		expect(allocator.capacity).toBe(20);

		allocator.prepareRange({ start: 10, end: 18, slotTopologyRevision: 2 });
		expect(allocator.capacity).toBe(8);
		expect(allocator.epoch).toBe(1);
	});

	it("grows capacity without remapping retained rows or changing pool epoch", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 10, end: 13, slotTopologyRevision: 3 });
		const previousEpoch = allocator.epoch;
		const retainedLeases = [10, 11, 12].map((rowIndex) =>
			allocator.resolveSlotLease(rowIndex),
		);

		allocator.prepareRange({ start: 10, end: 14, slotTopologyRevision: 3 });
		expect(allocator.capacity).toBe(4);
		expect(allocator.epoch).toBe(previousEpoch);
		expect(
			[10, 11, 12].map((rowIndex) => allocator.resolveSlotLease(rowIndex)),
		).toEqual(retainedLeases);

		allocator.prepareRange({ start: 10, end: 17, slotTopologyRevision: 3 });
		expect(allocator.capacity).toBe(7);
		expect(allocator.epoch).toBe(previousEpoch);
		expect(allocator.resolveSlotLease(10)?.rowSlotIndex).toBe(0);
	});

	it("does not compact after sustained substantial under-utilization", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 12, slotTopologyRevision: 3 });
		allocator.prepareRange({ start: 9, end: 12, slotTopologyRevision: 3 });
		allocator.prepareRange({ start: 9, end: 12, slotTopologyRevision: 3 });
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 9, end: 12, slotTopologyRevision: 3 });
		expect(allocator.capacity).toBe(12);
		expect(allocator.epoch).toBe(previousEpoch);
	});

	it("reuses slots released by an earlier reconciliation", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 4, slotTopologyRevision: 3 });
		allocator.prepareRange({ start: 3, end: 4, slotTopologyRevision: 3 });

		allocator.prepareRange({
			start: 3,
			end: 7,
			slotTopologyRevision: 3,
		});

		expect(allocator.capacity).toBe(4);
		expect(
			[3, 4, 5, 6]
				.map((rowIndex) => {
					const lease = allocator.resolveSlotLease(rowIndex);
					if (!lease) throw new Error(`Missing lease for row ${rowIndex}.`);
					return lease.rowSlotIndex;
				})
				.sort((left, right) => left - right),
		).toEqual([0, 1, 2, 3]);
	});

	it("does not resolve unassigned rows before prepare, outside the range, or after dispose", () => {
		const allocator = createResidentRowSlotAllocator();

		expect(allocator.resolveSlotLease(0)).toBeUndefined();
		allocator.prepareRange({ start: 10, end: 12, slotTopologyRevision: 3 });
		expect(allocator.resolveSlotLease(9)).toBeUndefined();
		expect(allocator.resolveSlotLease(12)).toBeUndefined();

		allocator.dispose();
		expect(allocator.resolveSlotLease(10)).toBeUndefined();
	});

	it("advances slot generation on owner change and pool epoch on topology reset", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 1, slotTopologyRevision: 3 });
		const initialLease = allocator.resolveSlotLease(0);

		allocator.prepareRange({ start: 1, end: 2, slotTopologyRevision: 3 });
		const reboundLease = allocator.resolveSlotLease(1);
		expect(reboundLease?.poolEpoch).toBe(initialLease?.poolEpoch);
		expect(reboundLease?.rowSlotIndex).toBe(initialLease?.rowSlotIndex);
		expect(reboundLease?.rowSlotGeneration).toBeGreaterThan(
			initialLease?.rowSlotGeneration ?? 0,
		);

		allocator.prepareRange({ start: 1, end: 2, slotTopologyRevision: 2 });
		const resetLease = allocator.resolveSlotLease(1);
		expect(resetLease?.poolEpoch).toBeGreaterThan(reboundLease?.poolEpoch ?? 0);
	});

	it("returns the same lightweight publication for an unchanged range", () => {
		const allocator = createResidentRowSlotAllocator();
		const initial = allocator.prepareRange({
			start: 10,
			end: 20,
			slotTopologyRevision: 3,
		});

		expect(
			allocator.prepareRange({
				start: 10,
				end: 20,
				slotTopologyRevision: 3,
			}),
		).toBe(initial);
	});

	it("distinguishes leases created by different allocator instances", () => {
		const first = createResidentRowSlotAllocator();
		const second = createResidentRowSlotAllocator();
		first.prepareRange({ start: 0, end: 1, slotTopologyRevision: 3 });
		second.prepareRange({ start: 0, end: 1, slotTopologyRevision: 3 });

		expect(first.resolveSlotLease(0)?.poolId).not.toBe(
			second.resolveSlotLease(0)?.poolId,
		);
	});
});
