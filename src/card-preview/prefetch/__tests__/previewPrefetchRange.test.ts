import { describe, expect, it } from "vitest";
import {
	createPreviewPrefetchRangeTracker,
	resolvePreviewPrefetchRange,
	resolvePreviewScrollDirection,
} from "../previewPrefetchRange";

describe("preview prefetch range", () => {
	it("uses one row on each side before a direction is known", () => {
		expect(
			resolvePreviewPrefetchRange({ start: 4, end: 7 }, 20, "stationary"),
		).toEqual({ start: 3, end: 8 });
	});

	it("keeps two rows only in the forward direction", () => {
		expect(
			resolvePreviewPrefetchRange({ start: 4, end: 7 }, 20, "forward"),
		).toEqual({ start: 4, end: 9 });
	});

	it("keeps two rows only in the backward direction", () => {
		expect(
			resolvePreviewPrefetchRange({ start: 4, end: 7 }, 20, "backward"),
		).toEqual({ start: 2, end: 7 });
	});

	it("retains direction until the visible row range moves", () => {
		expect(
			resolvePreviewScrollDirection(
				{ start: 4, end: 7 },
				{ start: 4, end: 7 },
				"forward",
			),
		).toBe("forward");
		expect(
			resolvePreviewScrollDirection(
				{ start: 4, end: 7 },
				{ start: 3, end: 6 },
				"forward",
			),
		).toBe("backward");
	});

	it("does not invent a direction when layout expands around the same center", () => {
		expect(
			resolvePreviewScrollDirection(
				{ start: 4, end: 6 },
				{ start: 3, end: 7 },
				"stationary",
			),
		).toBe("stationary");
	});

	it("tracks direction across successive visible ranges", () => {
		const tracker = createPreviewPrefetchRangeTracker();

		expect(tracker.resolve({ start: 4, end: 7 }, 20)).toEqual({
			start: 3,
			end: 8,
		});
		expect(tracker.resolve({ start: 5, end: 8 }, 20)).toEqual({
			start: 5,
			end: 10,
		});
		expect(tracker.resolve({ start: 4, end: 7 }, 20)).toEqual({
			start: 2,
			end: 7,
		});
	});
});
