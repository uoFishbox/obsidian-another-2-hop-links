import { describe, expect, it } from "vitest";
import { createResidentRowSlotAllocator } from "../residentSlotAllocator";

describe("createResidentRowSlotAllocator", () => {
	it("maps a contiguous range arithmetically and reuses the leaving slot", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 100, end: 120, layoutKey: "four-columns" });

		expect(allocator.capacity).toBe(27);
		expect(allocator.resolveSlotIndex(100)).toBe(19);
		expect(allocator.resolveSlotIndex(119)).toBe(11);
		expect(allocator.resolveSlotIndex(127)).toBe(19);
	});

	it("keeps peak capacity until a layout reset", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 20, layoutKey: "wide" });
		allocator.prepareRange({ start: 10, end: 18, layoutKey: "wide" });
		expect(allocator.capacity).toBe(27);

		allocator.prepareRange({ start: 10, end: 18, layoutKey: "narrow" });
		expect(allocator.capacity).toBe(12);
		expect(allocator.epoch).toBe(1);
	});

	it("uses growth headroom before starting a new epoch", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 10, end: 13, layoutKey: "layout" });
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 10, end: 14, layoutKey: "layout" });
		expect(allocator.capacity).toBe(6);
		expect(allocator.epoch).toBe(previousEpoch);

		allocator.prepareRange({ start: 10, end: 17, layoutKey: "layout" });
		expect(allocator.capacity).toBe(11);
		expect(allocator.epoch).toBe(previousEpoch + 1);
		expect(allocator.resolveSlotIndex(10)).toBe(10);
	});

	it("does not compact after sustained substantial under-utilization", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 12, layoutKey: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutKey: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutKey: "layout" });
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 9, end: 12, layoutKey: "layout" });
		expect(allocator.capacity).toBe(17);
		expect(allocator.epoch).toBe(previousEpoch);
	});
});
