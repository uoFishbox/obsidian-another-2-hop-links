import { describe, expect, it } from "vitest";
import { createPooledRowSlotAllocator } from "../pooledRowSlotAllocator";

describe("createPooledRowSlotAllocator", () => {
	it("keeps slots bounded across repeated window shrink and expansion", () => {
		const allocator = createPooledRowSlotAllocator();
		const apply = (start: number, count: number) =>
			allocator.apply({
				rowKeys: Array.from({ length: count }, (_, index) => start + index),
				layoutKey: "three-columns",
			});

		expect(apply(0, 10).slotIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(apply(9, 1).slotIndexes).toEqual([9]);
		expect(Math.max(...apply(9, 10).slotIndexes)).toBeLessThan(10);
		expect(apply(18, 1).slotIndexes[0]).toBeLessThan(10);
		expect(Math.max(...apply(18, 10).slotIndexes)).toBeLessThan(10);
		expect(allocator.capacity).toBe(10);
	});

	it("preserves retained slots and resets incompatible layouts", () => {
		const allocator = createPooledRowSlotAllocator();
		const initial = allocator.apply({ rowKeys: [4, 5, 6], layoutKey: 2 });
		const shifted = allocator.apply({ rowKeys: [5, 6, 7], layoutKey: 2 });

		expect(shifted.slotIndexes.slice(0, 2)).toEqual(
			initial.slotIndexes.slice(1),
		);
		const previousEpoch = shifted.epoch;
		const reset = allocator.apply({ rowKeys: [5, 6, 7], layoutKey: 3 });
		expect(reset.slotIndexes).toEqual([0, 1, 2]);
		expect(reset.epoch).toBe(previousEpoch + 1);
	});

	it("drops historical capacity when reset for an empty transition", () => {
		const allocator = createPooledRowSlotAllocator();
		allocator.apply({ rowKeys: [0, 1, 2, 3], layoutKey: "layout" });

		allocator.reset("empty");

		expect(allocator.capacity).toBe(0);
		expect(
			allocator.apply({ rowKeys: [20], layoutKey: "layout" }).slotIndexes,
		).toEqual([0]);
	});

	it("compacts capacity after sustained substantial under-utilization", () => {
		const allocator = createPooledRowSlotAllocator();
		allocator.apply({
			rowKeys: Array.from({ length: 12 }, (_, index) => index),
			layoutKey: "layout",
		});
		allocator.apply({ rowKeys: [11], layoutKey: "layout" });
		allocator.apply({ rowKeys: [11], layoutKey: "layout" });
		const compacted = allocator.apply({ rowKeys: [11], layoutKey: "layout" });

		expect(compacted.capacity).toBe(1);
		expect(compacted.slotIndexes).toEqual([0]);
	});
});
