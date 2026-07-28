import { describe, expect, it, vi } from "vitest";
import type { VirtualMeasurement } from "../../dom/virtualMeasurementController";
import type { VirtualRanges } from "../../types";
import { createVirtualScrollWindowMeasurementController } from "../virtualScrollWindowMeasurementController";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";

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
	it("exposes the intersection of mounted and published preview coverage", () => {
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
				previewCoverageScrollTopBand: { min: 30, max: 70 },
			}),
			applyRangeMeasurement: () => ({
				kind: "stable",
				range: { start: 2, end: 8 },
			}),
			onStableMeasurement: vi.fn(),
		});

		controller.applyScrollMeasurement(STABLE_MEASUREMENT, undefined);

		expect(controller.getScrollMeasurementRange()).toEqual({
			minScrollTopBeforeMeasurement: 30,
			maxScrollTopBeforeMeasurement: 70,
		});

		controller.resetLastScrollWindow();
		expect(controller.getScrollMeasurementRange()).toBeNull();
	});

	it("publishes preview changes while reusing an unchanged mounted range", () => {
		const resolveRanges = vi.fn(() => ({
			identity: IDENTITY,
			ranges: {
				mounted: { start: 0, end: 10 },
				previewVisible: { start: 3, end: 9 },
			},
			previewCoverageScrollTopBand: { min: 60, max: 100 },
		}));
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

		expect(resolveRanges).toHaveBeenCalledTimes(2);
		expect(applyRanges).toHaveBeenCalledTimes(2);
		expect(applyRanges.mock.calls[1]?.[2]).toEqual({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 3, end: 9 },
		});
	});

	it("classifies same mounted window hits by empty state", () => {
		resetCCLDevMeasurements();
		const controller = createVirtualScrollWindowMeasurementController({
			resolveMountedScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				mounted: { start: 0, end: 0 },
				mountedCoverageScrollTopBand: {
					min: Number.NEGATIVE_INFINITY,
					max: 100,
				},
			}),
			resolveScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				ranges: {
					mounted: { start: 0, end: 0 },
					previewVisible: { start: 0, end: 0 },
				},
			}),
			applyRangeMeasurement: () => ({
				kind: "stable",
				range: { start: 0, end: 0 },
			}),
			onStableMeasurement: vi.fn(),
		});

		controller.applyScrollMeasurement(STABLE_MEASUREMENT, undefined);
		controller.applyScrollMeasurement(
			{ ...STABLE_MEASUREMENT, scrollTop: 60 },
			undefined,
		);

		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["virtualScroll.sameMountedWindowHit"].count).toBe(1);
		expect(counters["virtualScroll.sameMountedWindowHit.empty"].count).toBe(1);
		expect(counters["virtualScroll.sameMountedWindowHit.nonEmpty"].count).toBe(0);
	});

	it("does not expose mounted coverage beyond published preview coverage", () => {
		const controller = createVirtualScrollWindowMeasurementController({
			resolveMountedScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				mounted: { start: 0, end: 10 },
				mountedCoverageScrollTopBand: { min: 60, max: 80 },
			}),
			resolveScrollWindowMeasurement: () => ({
				identity: IDENTITY,
				ranges: {
					mounted: { start: 0, end: 10 },
					previewVisible: { start: 2, end: 8 },
				},
				previewCoverageScrollTopBand: { min: 65, max: 75 },
			}),
			applyRangeMeasurement: () => ({
				kind: "stable",
				range: { start: 2, end: 8 },
			}),
			onStableMeasurement: vi.fn(),
		});

		controller.applyScrollMeasurement(STABLE_MEASUREMENT, undefined);

		expect(controller.getScrollMeasurementRange()).toEqual({
			minScrollTopBeforeMeasurement: 65,
			maxScrollTopBeforeMeasurement: 75,
		});
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
