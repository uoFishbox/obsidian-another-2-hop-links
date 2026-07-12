import { describe, expect, it } from "vitest";
import { createContiguousRowSlotAllocator } from "../contiguousRowSlotAllocator";

describe("createContiguousRowSlotAllocator", () => {
	it("maps a contiguous range arithmetically and reuses the leaving slot", () => {
		const allocator = createContiguousRowSlotAllocator();
		allocator.prepareRange({ start: 100, end: 120, layoutKey: "four-columns" });

		expect(allocator.capacity).toBe(20);
		expect(allocator.resolveSlotIndex(100)).toBe(0);
		expect(allocator.resolveSlotIndex(119)).toBe(19);
		expect(allocator.resolveSlotIndex(120)).toBe(0);
	});

	it("keeps peak capacity until a layout reset", () => {
		const allocator = createContiguousRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 20, layoutKey: "wide" });
		allocator.prepareRange({ start: 10, end: 18, layoutKey: "wide" });
		expect(allocator.capacity).toBe(20);

		allocator.prepareRange({ start: 10, end: 18, layoutKey: "narrow" });
		expect(allocator.capacity).toBe(8);
		expect(allocator.epoch).toBe(1);
	});

	it("starts a new epoch when capacity growth changes modulo mapping", () => {
		const allocator = createContiguousRowSlotAllocator();
		allocator.prepareRange({ start: 10, end: 13, layoutKey: "layout" });
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 10, end: 14, layoutKey: "layout" });

		expect(allocator.capacity).toBe(4);
		expect(allocator.epoch).toBe(previousEpoch + 1);
		expect(allocator.resolveSlotIndex(10)).toBe(2);
	});

	it("compacts capacity after sustained substantial under-utilization", () => {
		const allocator = createContiguousRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 12, layoutKey: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutKey: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutKey: "layout" });
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 9, end: 12, layoutKey: "layout" });

		expect(allocator.capacity).toBe(3);
		expect(allocator.epoch).toBe(previousEpoch + 1);
	});
});
