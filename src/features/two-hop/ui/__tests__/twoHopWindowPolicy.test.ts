import { describe, expect, it } from "vitest";
import {
	EMPTY_TWO_HOP_WINDOW,
	resolveTwoHopWindow,
	type ResolveTwoHopWindowInput,
	type TwoHopWindowMeasurement,
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
};

function createWindowResolver() {
	const measurement: TwoHopWindowMeasurement = { measurementRange: null };
	return {
		measurement,
		resolve(input: ResolveTwoHopWindowInput) {
			return resolveTwoHopWindow(input, measurement);
		},
	};
}

describe("resolveTwoHopWindow", () => {
	it("calculates the exact open coverage band directly from row geometry", () => {
		const { measurement, resolve } = createWindowResolver();
		const snapshot = resolve({
			geometry: GEOMETRY,
			mountedRowEnd: 20,
			scrollTop: 500,
			contentTopInScrollSpace: 0,
			viewportHeight: 300,
			offscreenBootstrapRows: 0,
			previewEnabled: true,
			previous: EMPTY_TWO_HOP_WINDOW,
		});

		expect(snapshot.active).toEqual({ start: 3, end: 9 });
		expect(snapshot.prepared.start).toBeLessThanOrEqual(snapshot.active.start);
		expect(snapshot.prepared.end).toBeGreaterThanOrEqual(snapshot.active.end);
		expect(measurement.measurementRange).toEqual({
			minScrollTopBeforeMeasurement: 470,
			maxScrollTopBeforeMeasurement: 540,
		});

		for (const scrollTop of [470.001, 539.999]) {
			const covered = resolve({
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

		for (const scrollTop of [470, 540]) {
			const boundary = resolve({
				geometry: GEOMETRY,
				mountedRowEnd: 20,
				scrollTop,
				contentTopInScrollSpace: 0,
				viewportHeight: 300,
				offscreenBootstrapRows: 0,
				previewEnabled: true,
				previous: snapshot,
			});
			expect(boundary.active).not.toEqual(snapshot.active);
		}
	});

	it("translates local coverage boundaries into scroll-container space", () => {
		const { measurement, resolve } = createWindowResolver();
		const snapshot = resolve({
			geometry: GEOMETRY,
			mountedRowEnd: 20,
			scrollTop: 600,
			contentTopInScrollSpace: 100,
			viewportHeight: 300,
			offscreenBootstrapRows: 0,
			previewEnabled: true,
			previous: EMPTY_TWO_HOP_WINDOW,
		});

		expect(snapshot.active).toEqual({ start: 3, end: 9 });
		expect(measurement.measurementRange).toEqual({
			minScrollTopBeforeMeasurement: 570,
			maxScrollTopBeforeMeasurement: 640,
		});
	});

	it("does not publish coverage for an invalid viewport", () => {
		const { measurement, resolve } = createWindowResolver();
		resolve({
			geometry: GEOMETRY,
			mountedRowEnd: 20,
			scrollTop: 500,
			contentTopInScrollSpace: 0,
			viewportHeight: 0,
			offscreenBootstrapRows: 0,
			previewEnabled: true,
			previous: EMPTY_TWO_HOP_WINDOW,
		});

		expect(measurement.measurementRange).toBeNull();
	});

	it("keeps card hydration active while disabling preview preparation", () => {
		const { resolve } = createWindowResolver();
		const snapshot = resolve({
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
		const { resolve } = createWindowResolver();
		const first = resolve({
			geometry: GEOMETRY,
			mountedRowEnd: 20,
			scrollTop: 500,
			contentTopInScrollSpace: 0,
			viewportHeight: 300,
			offscreenBootstrapRows: 0,
			previewEnabled: true,
			previous: EMPTY_TWO_HOP_WINDOW,
		});
		const second = resolve({
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
