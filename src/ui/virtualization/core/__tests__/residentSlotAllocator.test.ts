import { describe, expect, it } from "vitest";
import { createResidentRowSlotAllocator } from "../residentSlotAllocator";

describe("createResidentRowSlotAllocator", () => {
	it("maps a contiguous range arithmetically and reuses the leaving slot", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({
			start: 100,
			end: 120,
			layoutRevision: "four-columns",
		});

		expect(allocator.capacity).toBe(27);
		expect(allocator.resolveSlotIndex(100)).toBe(19);
		expect(allocator.resolveSlotIndex(119)).toBe(11);
		expect(allocator.resolveSlotIndex(127)).toBe(19);
	});

	it("keeps peak capacity until a layout reset", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 20, layoutRevision: "wide" });
		allocator.prepareRange({ start: 10, end: 18, layoutRevision: "wide" });
		expect(allocator.capacity).toBe(27);

		allocator.prepareRange({ start: 10, end: 18, layoutRevision: "narrow" });
		expect(allocator.capacity).toBe(12);
		expect(allocator.epoch).toBe(1);
	});

	it("uses growth headroom before starting a new epoch", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 10, end: 13, layoutRevision: "layout" });
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 10, end: 14, layoutRevision: "layout" });
		expect(allocator.capacity).toBe(6);
		expect(allocator.epoch).toBe(previousEpoch);

		allocator.prepareRange({ start: 10, end: 17, layoutRevision: "layout" });
		expect(allocator.capacity).toBe(11);
		expect(allocator.epoch).toBe(previousEpoch + 1);
		expect(allocator.resolveSlotIndex(10)).toBe(10);
	});

	it("does not compact after sustained substantial under-utilization", () => {
		const allocator = createResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 12, layoutRevision: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutRevision: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutRevision: "layout" });
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 9, end: 12, layoutRevision: "layout" });
		expect(allocator.capacity).toBe(17);
		expect(allocator.epoch).toBe(previousEpoch);
	});
});
