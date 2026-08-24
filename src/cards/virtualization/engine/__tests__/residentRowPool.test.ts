import { describe, expect, it } from "vitest";
import { createResidentRowSlotAllocator } from "../mountedGridRows";

describe("createResidentRowSlotAllocator", () => {
	it("uses exactly the mounted row count and reuses the leaving slot", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({
			start: 100,
			end: 120,
			slotTopologyRevision: 4,
		});

		expect(allocator.capacity).toBe(20);
		expect(allocator.resolveSlotIndex(100)).toBe(0);
		expect(allocator.resolveSlotIndex(119)).toBe(19);
		const retainedSlotIndex = allocator.resolveSlotIndex(101);

		allocator.prepareRange({
			start: 101,
			end: 121,
			slotTopologyRevision: 4,
		});
		expect(allocator.resolveSlotIndex(120)).toBe(0);
		expect(allocator.resolveSlotIndex(101)).toBe(retainedSlotIndex);
	});

	it("keeps peak capacity until a slot-topology reset", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 20, slotTopologyRevision: 4 });
		allocator.prepareRange({ start: 10, end: 18, slotTopologyRevision: 4 });
		expect(allocator.capacity).toBe(20);

		allocator.prepareRange({ start: 10, end: 18, slotTopologyRevision: 2 });
		expect(allocator.capacity).toBe(8);
	});

	it("grows capacity without remapping retained rows", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 10, end: 13, slotTopologyRevision: 3 });
		const retainedSlots = [10, 11, 12].map((rowIndex) =>
			allocator.resolveSlotIndex(rowIndex),
		);

		allocator.prepareRange({ start: 10, end: 14, slotTopologyRevision: 3 });
		expect(allocator.capacity).toBe(4);
		expect(
			[10, 11, 12].map((rowIndex) => allocator.resolveSlotIndex(rowIndex)),
		).toEqual(retainedSlots);

		allocator.prepareRange({ start: 10, end: 17, slotTopologyRevision: 3 });
		expect(allocator.capacity).toBe(7);
		expect(allocator.resolveSlotIndex(10)).toBe(0);
	});

	it("does not compact after sustained substantial under-utilization", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 12, slotTopologyRevision: 3 });
		allocator.prepareRange({ start: 9, end: 12, slotTopologyRevision: 3 });
		allocator.prepareRange({ start: 9, end: 12, slotTopologyRevision: 3 });
		allocator.prepareRange({ start: 9, end: 12, slotTopologyRevision: 3 });
		expect(allocator.capacity).toBe(12);
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
					const physicalRowSlot = allocator.resolveSlotIndex(rowIndex);
					if (physicalRowSlot === undefined) {
						throw new Error(`Missing slot for row ${rowIndex}.`);
					}
					return physicalRowSlot;
				})
				.sort((left, right) => left - right),
		).toEqual([0, 1, 2, 3]);
	});

	it("does not resolve unassigned rows before prepare or outside the range", () => {
		const allocator = createResidentRowSlotAllocator();

		expect(allocator.resolveSlotIndex(0)).toBeUndefined();
		allocator.prepareRange({ start: 10, end: 12, slotTopologyRevision: 3 });
		expect(allocator.resolveSlotIndex(9)).toBeUndefined();
		expect(allocator.resolveSlotIndex(12)).toBeUndefined();
	});

	it("keeps an unchanged range stable", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 10, end: 20, slotTopologyRevision: 3 });
		const slots = Array.from({ length: 10 }, (_, offset) =>
			allocator.resolveSlotIndex(10 + offset),
		);

		allocator.prepareRange({ start: 10, end: 20, slotTopologyRevision: 3 });

		expect(allocator.capacity).toBe(10);
		expect(
			Array.from({ length: 10 }, (_, offset) =>
				allocator.resolveSlotIndex(10 + offset),
			),
		).toEqual(slots);
	});

	it("fails fast when used after dispose while keeping dispose idempotent", () => {
		const allocator = createResidentRowSlotAllocator();
		const disposedError = "Resident row slot allocator has been disposed";

		allocator.dispose();
		expect(() =>
			allocator.prepareRange({
				start: 10,
				end: 12,
				slotTopologyRevision: 3,
			}),
		).toThrowError(disposedError);
		expect(() => allocator.resolveSlotIndex(10)).toThrowError(disposedError);
		expect(() => allocator.reset()).toThrowError(disposedError);
		expect(() => allocator.dispose()).not.toThrow();
	});
});
