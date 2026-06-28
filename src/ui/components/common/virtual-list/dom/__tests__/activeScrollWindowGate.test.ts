import { describe, expect, it } from "vitest";
import {
	createMountedScrollWindow,
	createScrollWindow,
	isSameMountedScrollWindow,
	isSameRangedScrollWindow,
	isWithinStableMountedScrollWindow,
	isWithinStablePreviewScrollWindow,
	updateMountedAndPreviewScrollWindow,
	updateMountedScrollWindow,
	updateScrollWindow,
} from "../activeScrollWindowGate";

describe("activeScrollWindowGate", () => {
	it("creates a comparable scroll window from mounted and visible ranges", () => {
		const identity = {};
		const scrollWindow = createScrollWindow(identity, {
			mounted: { start: 1, end: 5 },
			previewVisible: { start: 2, end: 4 },
		});

		expect(scrollWindow).toEqual({
			identity,
			mountedStart: 1,
			mountedEnd: 5,
			visibleStart: 2,
			visibleEnd: 4,
			stablePreviewScrollTopMin: Number.POSITIVE_INFINITY,
			stablePreviewScrollTopMax: Number.NEGATIVE_INFINITY,
			stableMountedScrollTopMin: Number.POSITIVE_INFINITY,
			stableMountedScrollTopMax: Number.NEGATIVE_INFINITY,
		});
	});

	it("compares mounted-only windows by identity and mounted range", () => {
		const identity = {};
		const previous = createMountedScrollWindow(identity, {
			start: 1,
			end: 5,
		});

		expect(
			isSameMountedScrollWindow(previous, identity, {
				start: 1,
				end: 5,
			}),
		).toBe(true);
		expect(
			isSameMountedScrollWindow(previous, identity, {
				start: 2,
				end: 5,
			}),
		).toBe(false);
		expect(
			isSameMountedScrollWindow(
				previous,
				{},
				{
					start: 1,
					end: 5,
				},
			),
		).toBe(false);
		expect(
			isSameMountedScrollWindow(null, identity, {
				start: 1,
				end: 5,
			}),
		).toBe(false);
	});

	it("requires visible range stability for visible-and-mounted comparison", () => {
		const identity = {};
		const previous = createScrollWindow(identity, {
			mounted: { start: 1, end: 5 },
			previewVisible: { start: 2, end: 4 },
		});

		expect(
			isSameRangedScrollWindow(
				previous,
				identity,
				{
					mounted: { start: 1, end: 5 },
					previewVisible: { start: 2, end: 4 },
				},
				"visible-and-mounted",
			),
		).toBe(true);
		expect(
			isSameRangedScrollWindow(
				previous,
				identity,
				{
					mounted: { start: 1, end: 5 },
					previewVisible: { start: 3, end: 4 },
				},
				"visible-and-mounted",
			),
		).toBe(false);
	});

	it("ignores visible range changes for mounted-only ranged comparison", () => {
		const identity = {};
		const previous = createScrollWindow(identity, {
			mounted: { start: 1, end: 5 },
			previewVisible: { start: 2, end: 4 },
		});

		expect(
			isSameRangedScrollWindow(
				previous,
				identity,
				{
					mounted: { start: 1, end: 5 },
					previewVisible: { start: 3, end: 5 },
				},
				"mounted-only",
			),
		).toBe(true);
	});

	it("updates an existing ranged scroll window in place", () => {
		const previous = createScrollWindow(
			{},
			{
				mounted: { start: 1, end: 5 },
				previewVisible: { start: 2, end: 4 },
			},
		);
		const identity = {};

		const updated = updateScrollWindow(previous, identity, {
			mounted: { start: 3, end: 8 },
			previewVisible: { start: 4, end: 7 },
		});

		expect(updated).toBe(previous);
		expect(updated).toEqual({
			identity,
			mountedStart: 3,
			mountedEnd: 8,
			visibleStart: 4,
			visibleEnd: 7,
			stablePreviewScrollTopMin: Number.POSITIVE_INFINITY,
			stablePreviewScrollTopMax: Number.NEGATIVE_INFINITY,
			stableMountedScrollTopMin: Number.POSITIVE_INFINITY,
			stableMountedScrollTopMax: Number.NEGATIVE_INFINITY,
		});
	});

	it("updates stable preview scroll bands for ranged windows", () => {
		const previous = createScrollWindow(
			{},
			{
				mounted: { start: 1, end: 5 },
				previewVisible: { start: 2, end: 4 },
			},
		);
		const identity = {};

		const updated = updateScrollWindow(
			previous,
			identity,
			{
				mounted: { start: 3, end: 8 },
				previewVisible: { start: 4, end: 7 },
			},
			{ min: 10, max: 20 },
		);

		expect(updated).toBe(previous);
		expect(updated.stablePreviewScrollTopMin).toBe(10);
		expect(updated.stablePreviewScrollTopMax).toBe(20);
		expect(
			isWithinStablePreviewScrollWindow(
				updated,
				identity,
				{ start: 3, end: 8 },
				15,
			),
		).toBe(true);
		expect(
			isWithinStablePreviewScrollWindow(
				updated,
				identity,
				{ start: 3, end: 8 },
				20,
			),
		).toBe(false);
	});

	it("updates an existing mounted scroll window in place", () => {
		const previous = createScrollWindow(
			{},
			{
				mounted: { start: 1, end: 5 },
				previewVisible: { start: 2, end: 4 },
			},
		);
		const identity = {};

		const updated = updateMountedScrollWindow(previous, identity, {
			start: 3,
			end: 8,
		});

		expect(updated).toBe(previous);
		expect(updated).toEqual({
			identity,
			mountedStart: 3,
			mountedEnd: 8,
			visibleStart: 0,
			visibleEnd: 0,
			stablePreviewScrollTopMin: Number.POSITIVE_INFINITY,
			stablePreviewScrollTopMax: Number.NEGATIVE_INFINITY,
			stableMountedScrollTopMin: Number.POSITIVE_INFINITY,
			stableMountedScrollTopMax: Number.NEGATIVE_INFINITY,
		});
	});

	it("updates mounted and preview stable scroll bands together", () => {
		const previous = createMountedScrollWindow(
			{},
			{ start: 1, end: 5 },
			{ min: 0, max: 100 },
		);
		const identity = {};

		const updated = updateMountedAndPreviewScrollWindow(
			previous,
			identity,
			{
				mounted: { start: 3, end: 8 },
				previewVisible: { start: 4, end: 7 },
			},
			{ min: 30, max: 40 },
			{ min: 20, max: 80 },
		);

		expect(updated).toBe(previous);
		expect(
			isWithinStablePreviewScrollWindow(
				updated,
				identity,
				{ start: 3, end: 8 },
				35,
			),
		).toBe(true);
		expect(
			isWithinStableMountedScrollWindow(
				updated,
				identity,
				{ start: 3, end: 8 },
				50,
			),
		).toBe(true);
	});
});
