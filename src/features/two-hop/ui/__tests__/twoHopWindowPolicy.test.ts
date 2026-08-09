import { describe, expect, it } from "vitest";
import {
	EMPTY_TWO_HOP_WINDOW,
	isScrollTopCovered,
	resolveTwoHopWindow,
} from "features/two-hop/ui/twoHopWindowPolicy";
import type { TwoHopGeometry } from "features/two-hop/ui/viewport/twoHopGeometry";

const GEOMETRY: TwoHopGeometry = {
	columns: 1,
	rowHeight: 100,
	rowStride: 110,
	rowCount: 20,
	totalHeight: 2_200,
	firstRowBySection: new Uint32Array([0]),
	rowCountBySection: new Uint32Array([20]),
	topBySection: new Float64Array([0]),
	heightBySection: new Float64Array([2_200]),
};

describe("resolveTwoHopWindow", () => {
	it("publishes active, prepared, and a stable scroll coverage band together", () => {
		const snapshot = resolveTwoHopWindow({
			geometry: GEOMETRY,
			mountedRowEnd: 20,
			scrollTop: 500,
			contentTopInScrollSpace: 0,
			viewportHeight: 300,
			offscreenBootstrapRows: 0,
			previewEnabled: true,
			previous: EMPTY_TWO_HOP_WINDOW,
		});

		expect(snapshot.active.start).toBeLessThan(snapshot.active.end);
		expect(snapshot.prepared.start).toBeLessThanOrEqual(snapshot.active.start);
		expect(snapshot.prepared.end).toBeGreaterThanOrEqual(snapshot.active.end);
		expect(snapshot.coverage).not.toBeNull();
		expect(isScrollTopCovered(snapshot.coverage, 500)).toBe(true);
		if (!snapshot.coverage) throw new Error("Coverage was not resolved");

		for (const scrollTop of [
			(snapshot.coverage.min + 500) / 2,
			(snapshot.coverage.max + 500) / 2,
		]) {
			const covered = resolveTwoHopWindow({
				geometry: GEOMETRY,
				mountedRowEnd: 20,
				scrollTop,
				contentTopInScrollSpace: 0,
				viewportHeight: 300,
				offscreenBootstrapRows: 0,
				previewEnabled: true,
				previous: snapshot,
			});
			expect(covered.active).toEqual(snapshot.active);
			expect(covered.prepared).toEqual(snapshot.prepared);
		}
	});

	it("keeps card hydration active while disabling preview preparation", () => {
		const snapshot = resolveTwoHopWindow({
			geometry: GEOMETRY,
			mountedRowEnd: 20,
			scrollTop: 500,
			contentTopInScrollSpace: 0,
			viewportHeight: 300,
			offscreenBootstrapRows: 0,
			previewEnabled: false,
			previous: EMPTY_TWO_HOP_WINDOW,
		});

		expect(snapshot.active.start).toBeLessThan(snapshot.active.end);
		expect(snapshot.prepared).toEqual({ start: 0, end: 0 });
	});

	it("reuses the previous prepared range while active rows stay in its guard", () => {
		const first = resolveTwoHopWindow({
			geometry: GEOMETRY,
			mountedRowEnd: 20,
			scrollTop: 500,
			contentTopInScrollSpace: 0,
			viewportHeight: 300,
			offscreenBootstrapRows: 0,
			previewEnabled: true,
			previous: EMPTY_TWO_HOP_WINDOW,
		});
		const second = resolveTwoHopWindow({
			geometry: GEOMETRY,
			mountedRowEnd: 20,
			scrollTop: 510,
			contentTopInScrollSpace: 0,
			viewportHeight: 300,
			offscreenBootstrapRows: 0,
			previewEnabled: true,
			previous: first,
		});

		expect(second.prepared).toEqual(first.prepared);
	});
});
