import { describe, expect, it } from "vitest";
import {
	resolveProgressivePreviewWindowInto,
	resolveProgressiveResidentRangeInto,
} from "features/two-hop/ui/twoHopWindowPolicy";
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

function resolveProgressivePreviewWindow(
	localViewportTop: number,
	viewportHeight: number,
	mountedRowEnd: number,
	offscreenBootstrapRows = 0,
): { range: TwoHopRowRange; stableBand: { min: number; max: number } } {
	const range: TwoHopRowRange = { start: 0, end: 0 };
	const stableBand = { min: 0, max: 0 };
	resolveProgressivePreviewWindowInto(
		range,
		stableBand,
		GEOMETRY,
		localViewportTop,
		viewportHeight,
		mountedRowEnd,
		offscreenBootstrapRows,
	);
	return { range, stableBand };
}

describe("resolveProgressivePreviewWindowInto", () => {
	it("includes one row of overscan while respecting section margins", () => {
		const { range } = resolveProgressivePreviewWindow(230, 20, 4);

		expect(range).toEqual({ start: 1, end: 3 });
	});

	it("clamps the preview range to the mounted row prefix", () => {
		const { range } = resolveProgressivePreviewWindow(230, 20, 2);

		expect(range).toEqual({ start: 1, end: 2 });
	});

	it("translates the geometry stable band through preview overscan", () => {
		const { range, stableBand } = resolveProgressivePreviewWindow(220, 20, 4);

		expect(range).toEqual({ start: 1, end: 3 });
		expect(stableBand).toEqual({ min: 210, max: 230 });
	});

	it("returns an empty range while the content is below the viewport", () => {
		const { range } = resolveProgressivePreviewWindow(-500, 200, 4);

		expect(range).toEqual({ start: 0, end: 0 });
	});

	it("returns the bounded bootstrap prefix while content is below the viewport", () => {
		const { range, stableBand } = resolveProgressivePreviewWindow(-500, 200, 4, 4);

		expect(range).toEqual({ start: 0, end: 4 });
		expect(stableBand).toEqual({
			min: Number.NEGATIVE_INFINITY,
			max: -200,
		});
	});

	it("clamps the offscreen bootstrap prefix to mounted rows", () => {
		const { range } = resolveProgressivePreviewWindow(-500, 200, 2, 4);

		expect(range).toEqual({ start: 0, end: 2 });
	});

	it("keeps an empty mounted prefix stable for every scroll position", () => {
		const { range, stableBand } = resolveProgressivePreviewWindow(230, 20, 0);

		expect(range).toEqual({ start: 0, end: 0 });
		expect(stableBand).toEqual({
			min: Number.NEGATIVE_INFINITY,
			max: Number.POSITIVE_INFINITY,
		});
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
