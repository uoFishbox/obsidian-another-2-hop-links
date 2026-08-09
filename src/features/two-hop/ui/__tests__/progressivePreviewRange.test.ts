import { describe, expect, it } from "vitest";
import {
	resolveProgressivePreviewRangeInto,
	resolveProgressiveResidentRangeInto,
} from "features/two-hop/ui/progressivePreviewRange";
import type {
	TwoHopGeometry,
	TwoHopRowRange,
} from "features/two-hop/ui/viewport/twoHopGeometry";

const GEOMETRY: TwoHopGeometry = {
	columns: 1,
	rowHeight: 100,
	rowStride: 110,
	rowCount: 4,
	totalHeight: 500,
	firstRowBySection: new Uint32Array([0, 2]),
	rowCountBySection: new Uint32Array([2, 2]),
	topBySection: new Float64Array([0, 250]),
};

describe("resolveProgressivePreviewRangeInto", () => {
	it("includes one row of overscan while respecting section margins", () => {
		const range: TwoHopRowRange = { start: 0, end: 0 };

		resolveProgressivePreviewRangeInto(range, GEOMETRY, 230, 20, 4);

		expect(range).toEqual({ start: 1, end: 3 });
	});

	it("clamps the preview range to the mounted row prefix", () => {
		const range: TwoHopRowRange = { start: 0, end: 0 };

		resolveProgressivePreviewRangeInto(range, GEOMETRY, 230, 20, 2);

		expect(range).toEqual({ start: 1, end: 2 });
	});

	it("returns an empty range while the content is below the viewport", () => {
		const range: TwoHopRowRange = { start: 0, end: 0 };

		resolveProgressivePreviewRangeInto(range, GEOMETRY, -500, 200, 4);

		expect(range).toEqual({ start: 0, end: 0 });
	});

	it("returns the bounded bootstrap prefix while content is below the viewport", () => {
		const range: TwoHopRowRange = { start: 0, end: 0 };

		resolveProgressivePreviewRangeInto(range, GEOMETRY, -500, 200, 4, 4);

		expect(range).toEqual({ start: 0, end: 4 });
	});

	it("clamps the offscreen bootstrap prefix to mounted rows", () => {
		const range: TwoHopRowRange = { start: 0, end: 0 };

		resolveProgressivePreviewRangeInto(range, GEOMETRY, -500, 200, 2, 4);

		expect(range).toEqual({ start: 0, end: 2 });
	});
});

describe("resolveProgressiveResidentRangeInto", () => {
	it("adds two bounded resident rows on each side of the active range", () => {
		const range: TwoHopRowRange = { start: 0, end: 0 };

		resolveProgressiveResidentRangeInto(
			range,
			{ start: 4, end: 8 },
			{ start: 0, end: 0 },
			20,
		);

		expect(range).toEqual({ start: 2, end: 10 });
	});

	it("preserves the resident range while active rows remain inside its guard", () => {
		const range: TwoHopRowRange = { start: 0, end: 0 };

		resolveProgressiveResidentRangeInto(
			range,
			{ start: 9, end: 15 },
			{ start: 8, end: 16 },
			20,
		);

		expect(range).toEqual({ start: 8, end: 16 });
	});

	it("moves the resident range after the active range crosses the guard", () => {
		const range: TwoHopRowRange = { start: 0, end: 0 };

		resolveProgressiveResidentRangeInto(
			range,
			{ start: 10, end: 16 },
			{ start: 8, end: 16 },
			20,
		);

		expect(range).toEqual({ start: 8, end: 18 });
	});

	it("clamps at mounted boundaries and empties with the active range", () => {
		const range: TwoHopRowRange = { start: 0, end: 0 };

		resolveProgressiveResidentRangeInto(
			range,
			{ start: 0, end: 3 },
			{ start: 0, end: 0 },
			4,
		);
		expect(range).toEqual({ start: 0, end: 4 });

		resolveProgressiveResidentRangeInto(range, { start: 0, end: 0 }, range, 4);
		expect(range).toEqual({ start: 0, end: 0 });
	});
});
