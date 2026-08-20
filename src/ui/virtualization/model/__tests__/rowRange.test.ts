import { describe, expect, it } from "vitest";
import { clampRange, EMPTY_ROW_RANGE, type MutableRowRange } from "../rowRange";

describe("clampRange", () => {
	it("protects the shared empty range from mutation", () => {
		expect(Object.isFrozen(EMPTY_ROW_RANGE)).toBe(true);
		expect(() => {
			(EMPTY_ROW_RANGE as MutableRowRange).start = 100;
		}).toThrow(TypeError);
		expect(EMPTY_ROW_RANGE).toEqual({ start: 0, end: 0 });
	});

	it("clamps a range that starts beyond the item count to an empty range at the end", () => {
		expect(clampRange({ start: 10, end: 20 }, 5)).toEqual({
			start: 5,
			end: 5,
		});
	});

	it("normalizes negative item counts to an empty range at zero", () => {
		expect(clampRange({ start: 1, end: 2 }, -1)).toEqual({
			start: 0,
			end: 0,
		});
	});
});
