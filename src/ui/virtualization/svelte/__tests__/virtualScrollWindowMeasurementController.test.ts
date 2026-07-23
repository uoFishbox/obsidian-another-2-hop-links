import { describe, expect, it, vi } from "vitest";
import type { VirtualMeasurement } from "../../dom/virtualMeasurementController";
import { createVirtualScrollWindowMeasurementController } from "../virtualScrollWindowMeasurementController";

const IDENTITY = {};
const STABLE_MEASUREMENT: VirtualMeasurement = {
	scrollTop: 50,
	viewportHeight: 100,
	sectionTop: 0,
	isStableMeasurement: true,
	isScrollActive: true,
	source: "scroll",
};

describe("createVirtualScrollWindowMeasurementController", () => {
	it("exposes the combined stable band containing the last measurement", () => {
		const controller = createVirtualScrollWindowMeasurementController({
			resolveMountedScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				mounted: { start: 0, end: 10 },
				stableMountedScrollTopBand: { min: 40, max: 60 },
			}),
			resolveScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				ranges: {
					mounted: { start: 0, end: 10 },
					previewVisible: { start: 2, end: 8 },
				},
				stablePreviewScrollTopBand: { min: 45, max: 70 },
			}),
			applyRangeMeasurement: () => ({
				kind: "stable",
				range: { start: 2, end: 8 },
			}),
			syncPreviewRange: vi.fn(),
			onStableMeasurement: vi.fn(),
		});

		controller.applyScrollMeasurement(STABLE_MEASUREMENT, undefined);

		expect(controller.getScrollMeasurementRange()).toEqual({
			minScrollTopBeforeMeasurement: 40,
			maxScrollTopBeforeMeasurement: 70,
		});

		controller.resetLastScrollWindow();
		expect(controller.getScrollMeasurementRange()).toBeNull();
	});

	it("does not bridge disjoint stable bands", () => {
		const controller = createVirtualScrollWindowMeasurementController({
			resolveMountedScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				mounted: { start: 0, end: 10 },
				stableMountedScrollTopBand: { min: 40, max: 60 },
			}),
			resolveScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				ranges: {
					mounted: { start: 0, end: 10 },
					previewVisible: { start: 2, end: 8 },
				},
				stablePreviewScrollTopBand: { min: 80, max: 100 },
			}),
			applyRangeMeasurement: () => ({
				kind: "stable",
				range: { start: 2, end: 8 },
			}),
			syncPreviewRange: vi.fn(),
			onStableMeasurement: vi.fn(),
		});

		controller.applyScrollMeasurement(STABLE_MEASUREMENT, undefined);

		expect(controller.getScrollMeasurementRange()).toEqual({
			minScrollTopBeforeMeasurement: 40,
			maxScrollTopBeforeMeasurement: 60,
		});
	});
});
