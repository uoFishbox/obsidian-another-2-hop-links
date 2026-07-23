import { describe, expect, it, vi } from "vitest";
import type { VirtualMeasurement } from "../../dom/virtualMeasurementController";
import type { VirtualRanges } from "../../types";
import { createVirtualScrollWindowMeasurementController } from "../virtualScrollWindowMeasurementController";

const IDENTITY = {};
const STABLE_MEASUREMENT: VirtualMeasurement = {
	scrollTop: 50,
	viewportHeight: 100,
	sectionTop: 0,
	isStableMeasurement: true,
	isScrollActive: true,
	scrollGeneration: 1,
	source: "scroll",
};

describe("createVirtualScrollWindowMeasurementController", () => {
	it("exposes the resident mounted coverage band", () => {
		const controller = createVirtualScrollWindowMeasurementController({
			resolveMountedScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				mounted: { start: 0, end: 10 },
				stableMountedScrollTopBand: { min: 40, max: 60 },
				mountedCoverageScrollTopBand: { min: 20, max: 80 },
			}),
			resolveScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				ranges: {
					mounted: { start: 0, end: 10 },
					previewVisible: { start: 2, end: 8 },
				},
			}),
			applyRangeMeasurement: () => ({
				kind: "stable",
				range: { start: 2, end: 8 },
			}),
			onStableMeasurement: vi.fn(),
		});

		controller.applyScrollMeasurement(STABLE_MEASUREMENT, undefined);

		expect(controller.getScrollMeasurementRange()).toEqual({
			minScrollTopBeforeMeasurement: 20,
			maxScrollTopBeforeMeasurement: 80,
		});

		controller.resetLastScrollWindow();
		expect(controller.getScrollMeasurementRange()).toBeNull();
	});

	it("does not resolve or publish preview changes while mounted range is unchanged", () => {
		const resolveRanges = vi.fn(() => ({
			identity: IDENTITY,
			ranges: {
				mounted: { start: 0, end: 10 },
				previewVisible: { start: 3, end: 9 },
			},
		}));
		const applyRanges = vi.fn(() => ({
			kind: "stable" as const,
			range: { start: 2, end: 8 },
		}));
		const controller = createVirtualScrollWindowMeasurementController({
			resolveMountedScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				mounted: { start: 0, end: 10 },
				stableMountedScrollTopBand: { min: 40, max: 60 },
			}),
			resolveScrollWindowMeasurement: resolveRanges,
			applyRangeMeasurement: applyRanges,
			onStableMeasurement: vi.fn(),
		});

		controller.applyScrollMeasurement(STABLE_MEASUREMENT, undefined);
		controller.applyScrollMeasurement(
			{ ...STABLE_MEASUREMENT, scrollTop: 70 },
			undefined,
		);

		expect(resolveRanges).toHaveBeenCalledTimes(1);
		expect(applyRanges).toHaveBeenCalledTimes(1);
	});

	it("publishes the full range when the mounted range changes", () => {
		let mountedStart = 0;
		const resolveRanges = vi.fn(() => ({
			identity: IDENTITY,
			ranges: {
				mounted: { start: mountedStart, end: mountedStart + 10 },
				previewVisible: { start: mountedStart + 2, end: mountedStart + 8 },
			},
		}));
		const applyRanges = vi.fn(
			(
				_measurement: VirtualMeasurement,
				_context: undefined,
				_precomputedRanges: VirtualRanges | undefined,
			) => ({
				kind: "stable" as const,
				range: { start: mountedStart + 2, end: mountedStart + 8 },
			}),
		);
		const controller = createVirtualScrollWindowMeasurementController({
			resolveMountedScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				mounted: { start: mountedStart, end: mountedStart + 10 },
			}),
			resolveScrollWindowMeasurement: resolveRanges,
			applyRangeMeasurement: applyRanges,
			onStableMeasurement: vi.fn(),
		});

		controller.applyScrollMeasurement(STABLE_MEASUREMENT, undefined);
		mountedStart = 1;
		controller.applyScrollMeasurement(
			{ ...STABLE_MEASUREMENT, scrollTop: 70 },
			undefined,
		);

		expect(resolveRanges).toHaveBeenCalledTimes(2);
		expect(applyRanges).toHaveBeenCalledTimes(2);
		expect(applyRanges.mock.calls[1]?.[2]).toEqual({
			mounted: { start: 1, end: 11 },
			previewVisible: { start: 3, end: 9 },
		});
	});

	it("recomputes ranges through the normal measurement path when scroll becomes idle", () => {
		const applyRanges = vi.fn(
			(
				_measurement: VirtualMeasurement,
				_context: undefined,
				_precomputedRanges: VirtualRanges | undefined,
			) => ({
				kind: "stable" as const,
				range: { start: 2, end: 8 },
			}),
		);
		const controller = createVirtualScrollWindowMeasurementController({
			resolveMountedScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				mounted: { start: 0, end: 10 },
			}),
			resolveScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				ranges: {
					mounted: { start: 0, end: 10 },
					previewVisible: { start: 2, end: 8 },
				},
			}),
			applyRangeMeasurement: applyRanges,
			onStableMeasurement: vi.fn(),
		});

		controller.applyScrollMeasurement(
			{ ...STABLE_MEASUREMENT, isScrollActive: false },
			undefined,
		);

		expect(applyRanges).toHaveBeenCalledOnce();
		expect(applyRanges.mock.calls[0]?.[2]).toBeUndefined();
	});
});
