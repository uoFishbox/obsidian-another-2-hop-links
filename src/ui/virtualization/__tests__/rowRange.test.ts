import { describe, expect, it } from "vitest";
import { clampRange } from "../rowRange";

describe("clampRange", () => {
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
