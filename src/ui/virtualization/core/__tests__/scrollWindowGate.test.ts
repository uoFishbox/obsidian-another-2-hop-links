import { describe, expect, it } from "vitest";
import {
	createMountedScrollWindow,
	updateMountedScrollWindow,
} from "../scrollWindowGate";

describe("scrollWindowGate", () => {
	it("updates an existing mounted window in place", () => {
		const previous = createMountedScrollWindow({ min: 0, max: 100 });

		const updated = updateMountedScrollWindow(previous, { min: 10, max: 90 });

		expect(updated).toBe(previous);
		expect(updated).toEqual({
			coverageScrollTopMin: 10,
			coverageScrollTopMax: 90,
		});
	});

	it("uses an invalid interval when coverage is unavailable", () => {
		expect(createMountedScrollWindow()).toEqual({
			coverageScrollTopMin: Number.POSITIVE_INFINITY,
			coverageScrollTopMax: Number.NEGATIVE_INFINITY,
		});
	});
});
