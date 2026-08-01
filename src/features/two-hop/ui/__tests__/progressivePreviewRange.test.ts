import { describe, expect, it } from "vitest";
import { resolveProgressivePreviewRangeInto } from "features/two-hop/ui/progressivePreviewRange";
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
	heightBySection: new Float64Array([250, 250]),
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
});
