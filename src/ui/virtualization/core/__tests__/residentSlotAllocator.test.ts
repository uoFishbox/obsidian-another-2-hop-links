import { describe, expect, it } from "vitest";
import { createResidentRowSlotAllocator } from "../residentSlotAllocator";

describe("createResidentRowSlotAllocator", () => {
	it("uses exactly the mounted row count and reuses the leaving slot", () => {
		const allocator = createResidentRowSlotAllocator();
		const initial = allocator.prepareRange({
			start: 100,
			end: 120,
			layoutRevision: "four-columns",
		});

		expect(allocator.capacity).toBe(20);
		expect(allocator.resolveSlotIndex(100)).toBe(0);
		expect(allocator.resolveSlotIndex(119)).toBe(19);
		const retainedLease = allocator.resolveSlotLease(101);

		const shifted = allocator.prepareRange({
			start: 101,
			end: 121,
			layoutRevision: "four-columns",
		});
		expect(allocator.resolveSlotIndex(120)).toBe(0);
		expect(allocator.resolveSlotLease(101)).toBe(retainedLease);
		expect(allocator.resolveSlotLease(120)?.slotGeneration).toBeGreaterThan(1);
		expect(shifted.revision).toBe(initial.revision + 1);
	});

	it("keeps peak capacity until a layout reset", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 20, layoutRevision: "wide" });
		allocator.prepareRange({ start: 10, end: 18, layoutRevision: "wide" });
		expect(allocator.capacity).toBe(20);

		allocator.prepareRange({ start: 10, end: 18, layoutRevision: "narrow" });
		expect(allocator.capacity).toBe(8);
		expect(allocator.epoch).toBe(1);
	});

	it("grows capacity without remapping retained rows or changing pool epoch", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 10, end: 13, layoutRevision: "layout" });
		const previousEpoch = allocator.epoch;
		const retainedLeases = [10, 11, 12].map((rowIndex) =>
			allocator.resolveSlotLease(rowIndex),
		);

		allocator.prepareRange({ start: 10, end: 14, layoutRevision: "layout" });
		expect(allocator.capacity).toBe(4);
		expect(allocator.epoch).toBe(previousEpoch);
		expect(
			[10, 11, 12].map((rowIndex) => allocator.resolveSlotLease(rowIndex)),
		).toEqual(retainedLeases);

		allocator.prepareRange({ start: 10, end: 17, layoutRevision: "layout" });
		expect(allocator.capacity).toBe(7);
		expect(allocator.epoch).toBe(previousEpoch);
		expect(allocator.resolveSlotIndex(10)).toBe(0);
	});

	it("does not compact after sustained substantial under-utilization", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 12, layoutRevision: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutRevision: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutRevision: "layout" });
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 9, end: 12, layoutRevision: "layout" });
		expect(allocator.capacity).toBe(12);
		expect(allocator.epoch).toBe(previousEpoch);
	});

	it("reuses slots released by an earlier reconciliation", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 4, layoutRevision: "layout" });
		allocator.prepareRange({ start: 3, end: 4, layoutRevision: "layout" });

		allocator.prepareRange({
			start: 3,
			end: 7,
			layoutRevision: "layout",
		});

		expect(allocator.capacity).toBe(4);
		expect(
			[3, 4, 5, 6]
				.map((rowIndex) => allocator.resolveSlotIndex(rowIndex))
				.sort((left, right) => left - right),
		).toEqual([0, 1, 2, 3]);
	});

	it("advances slot generation on owner change and pool epoch on layout reset", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 1, layoutRevision: "layout-a" });
		const initialLease = allocator.resolveSlotLease(0);

		allocator.prepareRange({ start: 1, end: 2, layoutRevision: "layout-a" });
		const reboundLease = allocator.resolveSlotLease(1);
		expect(reboundLease?.poolEpoch).toBe(initialLease?.poolEpoch);
		expect(reboundLease?.slotIndex).toBe(initialLease?.slotIndex);
		expect(reboundLease?.slotGeneration).toBeGreaterThan(
			initialLease?.slotGeneration ?? 0,
		);

		allocator.prepareRange({ start: 1, end: 2, layoutRevision: "layout-b" });
		const resetLease = allocator.resolveSlotLease(1);
		expect(resetLease?.poolEpoch).toBeGreaterThan(reboundLease?.poolEpoch ?? 0);
	});

	it("returns the same lightweight publication for an unchanged range", () => {
		const allocator = createResidentRowSlotAllocator();
		const initial = allocator.prepareRange({
			start: 10,
			end: 20,
			layoutRevision: "layout",
		});

		expect(
			allocator.prepareRange({
				start: 10,
				end: 20,
				layoutRevision: "layout",
			}),
		).toBe(initial);
	});

	it("distinguishes leases created by different allocator instances", () => {
		const first = createResidentRowSlotAllocator();
		const second = createResidentRowSlotAllocator();
		first.prepareRange({ start: 0, end: 1, layoutRevision: "layout" });
		second.prepareRange({ start: 0, end: 1, layoutRevision: "layout" });

		expect(first.resolveSlotLease(0)?.poolId).not.toBe(
			second.resolveSlotLease(0)?.poolId,
		);
	});
});
