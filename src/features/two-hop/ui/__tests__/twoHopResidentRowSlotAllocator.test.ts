import { describe, expect, it } from "vitest";
import { createTwoHopResidentRowSlotAllocator } from "features/two-hop/ui/twoHopResidentRowSlotAllocator";

function resolveRangeSlots(params: {
	readonly allocator: ReturnType<typeof createTwoHopResidentRowSlotAllocator>;
	readonly start: number;
	readonly end: number;
}): number[] {
	const slots: number[] = [];
	for (let rowIndex = params.start; rowIndex < params.end; rowIndex += 1) {
		slots.push(params.allocator.resolveSlotIndex(rowIndex));
	}
	return slots;
}

describe("createTwoHopResidentRowSlotAllocator", () => {
	it("retains overlapping rows and immediately reuses the leaving slot", () => {
		const allocator = createTwoHopResidentRowSlotAllocator();
		const initialDelta = allocator.prepareRange({
			start: 100,
			end: 120,
			layoutKey: "four-columns",
		});

		const leavingSlot = allocator.resolveSlotIndex(100);
		const retainedSlot = allocator.resolveSlotIndex(101);
		expect(allocator.capacity).toBe(27);
		expect(initialDelta.enteredSlots).toHaveLength(20);
		expect(initialDelta.reboundSlots).toEqual([]);

		const shiftedDelta = allocator.prepareRange({
			start: 101,
			end: 121,
			layoutKey: "four-columns",
		});

		expect(allocator.resolveSlotIndex(101)).toBe(retainedSlot);
		expect(allocator.resolveSlotIndex(120)).toBe(leavingSlot);
		expect(shiftedDelta.enteredSlots).toEqual([]);
		expect(shiftedDelta.reboundSlots).toEqual([
			{
				slotIndex: leavingSlot,
				previousLogicalRowIndex: 100,
				logicalRowIndex: 120,
			},
		]);
		expect(shiftedDelta.retainedSlots).toHaveLength(19);
		expect(shiftedDelta.releasedSlots).toEqual([]);
		expect(
			new Set(resolveRangeSlots({ allocator, start: 101, end: 121 })).size,
		).toBe(20);
	});

	it("reports slots released without replacement", () => {
		const allocator = createTwoHopResidentRowSlotAllocator();
		allocator.prepareRange({ start: 10, end: 14, layoutKey: "layout" });
		const releasedSlot = allocator.resolveSlotIndex(10);

		const delta = allocator.prepareRange({
			start: 11,
			end: 14,
			layoutKey: "layout",
		});

		expect(delta.retainedSlots).toHaveLength(3);
		expect(delta.reboundSlots).toEqual([]);
		expect(delta.releasedSlots).toEqual([
			{ slotIndex: releasedSlot, logicalRowIndex: 10 },
		]);
	});

	it("reuses the same physical slot set after a non-overlapping jump", () => {
		const allocator = createTwoHopResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 4, layoutKey: "layout" });
		const initialSlots = resolveRangeSlots({
			allocator,
			start: 0,
			end: 4,
		}).sort((left, right) => left - right);

		allocator.prepareRange({ start: 100, end: 104, layoutKey: "layout" });
		const jumpedSlots = resolveRangeSlots({
			allocator,
			start: 100,
			end: 104,
		}).sort((left, right) => left - right);

		expect(jumpedSlots).toEqual(initialSlots);
	});

	it("prefers the just-released slot over older free capacity", () => {
		const allocator = createTwoHopResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 8, layoutKey: "layout" });
		allocator.prepareRange({ start: 5, end: 8, layoutKey: "layout" });
		const residentSlots = resolveRangeSlots({
			allocator,
			start: 5,
			end: 8,
		}).sort((left, right) => left - right);
		const leavingSlot = allocator.resolveSlotIndex(5);

		allocator.prepareRange({ start: 6, end: 9, layoutKey: "layout" });

		expect(allocator.resolveSlotIndex(8)).toBe(leavingSlot);
		expect(
			resolveRangeSlots({ allocator, start: 6, end: 9 }).sort(
				(left, right) => left - right,
			),
		).toEqual(residentSlots);
	});

	it("keeps peak capacity until a layout reset", () => {
		const allocator = createTwoHopResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 20, layoutKey: "wide" });
		allocator.prepareRange({ start: 10, end: 18, layoutKey: "wide" });
		expect(allocator.capacity).toBe(27);

		allocator.prepareRange({ start: 10, end: 18, layoutKey: "narrow" });
		expect(allocator.capacity).toBe(12);
		expect(allocator.epoch).toBe(1);
		expect(
			resolveRangeSlots({ allocator, start: 10, end: 18 }).every(
				(slotIndex) => slotIndex < allocator.capacity,
			),
		).toBe(true);
	});

	it("uses growth headroom before starting a new epoch", () => {
		const allocator = createTwoHopResidentRowSlotAllocator();
		allocator.prepareRange({ start: 10, end: 13, layoutKey: "layout" });
		const retainedSlot = allocator.resolveSlotIndex(10);
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 10, end: 14, layoutKey: "layout" });
		expect(allocator.capacity).toBe(6);
		expect(allocator.epoch).toBe(previousEpoch);
		expect(allocator.resolveSlotIndex(10)).toBe(retainedSlot);

		allocator.prepareRange({ start: 10, end: 17, layoutKey: "layout" });
		expect(allocator.capacity).toBe(11);
		expect(allocator.epoch).toBe(previousEpoch + 1);
		expect(allocator.resolveSlotIndex(10)).toBe(retainedSlot);
	});

	it("does not compact after sustained substantial under-utilization", () => {
		const allocator = createTwoHopResidentRowSlotAllocator();
		allocator.prepareRange({ start: 0, end: 12, layoutKey: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutKey: "layout" });
		allocator.prepareRange({ start: 9, end: 12, layoutKey: "layout" });
		const previousEpoch = allocator.epoch;

		allocator.prepareRange({ start: 9, end: 12, layoutKey: "layout" });
		expect(allocator.capacity).toBe(17);
		expect(allocator.epoch).toBe(previousEpoch);
	});
});
