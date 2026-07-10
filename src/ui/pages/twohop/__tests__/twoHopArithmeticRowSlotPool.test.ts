import { describe, expect, it } from "vitest";
import { createTwoHopArithmeticRowSlotPool } from "../twoHopArithmeticRowSlotPool";

describe("createTwoHopArithmeticRowSlotPool", () => {
	it("maps a contiguous range arithmetically and reuses the leaving slot", () => {
		const pool = createTwoHopArithmeticRowSlotPool();
		pool.prepareRange(100, 120, "four-columns");

		expect(pool.capacity).toBe(20);
		expect(pool.resolveSlotIndex(100)).toBe(0);
		expect(pool.resolveSlotIndex(119)).toBe(19);
		expect(pool.resolveSlotIndex(120)).toBe(0);
	});

	it("keeps peak capacity until a layout reset", () => {
		const pool = createTwoHopArithmeticRowSlotPool();
		pool.prepareRange(0, 20, "wide");
		pool.prepareRange(10, 18, "wide");
		expect(pool.capacity).toBe(20);

		pool.prepareRange(10, 18, "narrow");
		expect(pool.capacity).toBe(8);
		expect(pool.epoch).toBe(1);
	});

	it("starts a new epoch when capacity growth changes modulo mapping", () => {
		const pool = createTwoHopArithmeticRowSlotPool();
		pool.prepareRange(10, 13, "layout");
		const previousEpoch = pool.epoch;

		pool.prepareRange(10, 14, "layout");

		expect(pool.capacity).toBe(4);
		expect(pool.epoch).toBe(previousEpoch + 1);
		expect(pool.resolveSlotIndex(10)).toBe(2);
	});

	it("compacts capacity after sustained substantial under-utilization", () => {
		const pool = createTwoHopArithmeticRowSlotPool();
		pool.prepareRange(0, 12, "layout");
		pool.prepareRange(9, 12, "layout");
		pool.prepareRange(9, 12, "layout");
		const previousEpoch = pool.epoch;

		pool.prepareRange(9, 12, "layout");

		expect(pool.capacity).toBe(3);
		expect(pool.epoch).toBe(previousEpoch + 1);
	});
});
