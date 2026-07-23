import { describe, expect, it } from "vitest";
import {
	createMountedScrollWindow,
	isSameMountedScrollWindow,
	isWithinStableMountedScrollWindow,
	updateMountedScrollWindow,
} from "../scrollWindowGate";

describe("scrollWindowGate", () => {
	it("compares mounted windows by identity and range", () => {
		const identity = {};
		const previous = createMountedScrollWindow(identity, {
			start: 1,
			end: 5,
		});

		expect(
			isSameMountedScrollWindow(previous, identity, { start: 1, end: 5 }),
		).toBe(true);
		expect(
			isSameMountedScrollWindow(previous, identity, { start: 2, end: 5 }),
		).toBe(false);
		expect(isSameMountedScrollWindow(previous, {}, { start: 1, end: 5 })).toBe(
			false,
		);
		expect(isSameMountedScrollWindow(null, identity, { start: 1, end: 5 })).toBe(
			false,
		);
	});

	it("updates an existing mounted window in place", () => {
		const previous = createMountedScrollWindow(
			{},
			{ start: 1, end: 5 },
			{ min: 0, max: 100 },
		);
		const identity = {};

		const updated = updateMountedScrollWindow(
			previous,
			identity,
			{ start: 3, end: 8 },
			{ min: 20, max: 80 },
		);

		expect(updated).toBe(previous);
		expect(updated).toEqual({
			identity,
			mountedStart: 3,
			mountedEnd: 8,
			stableScrollTopMin: 20,
			stableScrollTopMax: 80,
		});
	});

	it("uses an open mounted stable band", () => {
		const identity = {};
		const previous = createMountedScrollWindow(
			identity,
			{ start: 1, end: 5 },
			{ min: 10, max: 20 },
		);

		expect(
			isWithinStableMountedScrollWindow(
				previous,
				identity,
				{ start: 1, end: 5 },
				15,
			),
		).toBe(true);
		expect(
			isWithinStableMountedScrollWindow(
				previous,
				identity,
				{ start: 1, end: 5 },
				20,
			),
		).toBe(false);
	});
});
