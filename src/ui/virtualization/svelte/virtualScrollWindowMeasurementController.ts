import type { MeasurementUpdateResult } from "../dom/virtualListMeasurementAdapter";
import type {
	VirtualMeasurement,
	VirtualMeasurementApplicationResult,
} from "../dom/virtualMeasurementController";
import {
	createMountedScrollWindow,
	isSameMountedScrollWindow,
	isWithinStableMountedScrollWindow,
	type LastMountedScrollWindow,
	type MountedScrollWindowMeasurement,
	type RangedScrollWindowMeasurement,
	type ScrollMeasurementRange,
	updateMountedScrollWindow,
} from "../core/scrollWindowGate";
import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

export interface CreateVirtualScrollWindowMeasurementControllerOptions<TContext> {
	applyUnstableScrollMeasurement?: boolean;
	resolveMountedScrollWindowMeasurement(
		measurement: VirtualMeasurement,
		context: TContext,
	): MountedScrollWindowMeasurement;
	resolveScrollWindowMeasurement(
		measurement: VirtualMeasurement,
		context: TContext,
		precomputedMountedRange: RowRange | undefined,
	): RangedScrollWindowMeasurement;
	applyRangeMeasurement(
		measurement: VirtualMeasurement,
		context: TContext,
		precomputedRanges: VirtualRanges | undefined,
	): MeasurementUpdateResult<RowRange>;
	onStableMeasurement(measurement: VirtualMeasurement, context: TContext): void;
}

export function createVirtualScrollWindowMeasurementController<TContext>({
	applyUnstableScrollMeasurement = true,
	resolveMountedScrollWindowMeasurement,
	resolveScrollWindowMeasurement,
	applyRangeMeasurement,
	onStableMeasurement,
}: CreateVirtualScrollWindowMeasurementControllerOptions<TContext>) {
	let lastMountedScrollWindow: LastMountedScrollWindow | null = null;
	const scrollMeasurementRange: {
		-readonly [K in keyof ScrollMeasurementRange]: ScrollMeasurementRange[K];
	} = {
		minScrollTopBeforeMeasurement: 0,
		maxScrollTopBeforeMeasurement: 0,
	};

	const toApplicationResult = (
		result: MeasurementUpdateResult<RowRange>,
	): VirtualMeasurementApplicationResult =>
		result.kind === "stable" ? "stable" : "unstable";

	const resetLastScrollWindow = (): void => {
		lastMountedScrollWindow = null;
	};

	const getScrollMeasurementRange = (): ScrollMeasurementRange | null => {
		if (
			!lastMountedScrollWindow ||
			!(
				lastMountedScrollWindow.coverageScrollTopMin <
				lastMountedScrollWindow.coverageScrollTopMax
			)
		) {
			return null;
		}

		scrollMeasurementRange.minScrollTopBeforeMeasurement =
			lastMountedScrollWindow.coverageScrollTopMin;
		scrollMeasurementRange.maxScrollTopBeforeMeasurement =
			lastMountedScrollWindow.coverageScrollTopMax;
		return scrollMeasurementRange;
	};

	const primeLastScrollWindow = (
		measurement: VirtualMeasurement,
		context: TContext,
	): void => {
		if (!measurement.isStableMeasurement) {
			lastMountedScrollWindow = null;
			return;
		}

		const mountedMeasurement = resolveMountedScrollWindowMeasurement(
			measurement,
			context,
		);
		lastMountedScrollWindow = createMountedScrollWindow(
			mountedMeasurement.identity,
			mountedMeasurement.mounted,
			mountedMeasurement.stableMountedScrollTopBand,
			mountedMeasurement.mountedCoverageScrollTopBand,
		);
	};

	const returnStableScrollMeasurement = (
		measurement: VirtualMeasurement,
		context: TContext,
	): VirtualMeasurementApplicationResult => {
		onStableMeasurement(measurement, context);
		return "stable";
	};

	const applyScrollMeasurement = (
		nextMeasurement: VirtualMeasurement,
		context: TContext,
	): VirtualMeasurementApplicationResult => {
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualScroll.applyScrollMeasurement");
		}

		if (!nextMeasurement.isStableMeasurement && !applyUnstableScrollMeasurement) {
			lastMountedScrollWindow = null;
			return "unstable";
		}

		let pendingMountedMeasurement: MountedScrollWindowMeasurement | null = null;
		let precomputedRanges: VirtualRanges | undefined;

		if (nextMeasurement.isStableMeasurement && nextMeasurement.isScrollActive) {
			const mountedMeasurement = resolveMountedScrollWindowMeasurement(
				nextMeasurement,
				context,
			);
			if (
				isWithinStableMountedScrollWindow(
					lastMountedScrollWindow,
					mountedMeasurement.identity,
					mountedMeasurement.mounted,
					nextMeasurement.scrollTop,
				)
			) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.stableBandHit");
				}
				return returnStableScrollMeasurement(nextMeasurement, context);
			}
			if (
				isSameMountedScrollWindow(
					lastMountedScrollWindow,
					mountedMeasurement.identity,
					mountedMeasurement.mounted,
				)
			) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.sameMountedWindowHit");
					recordCCLDevMeasurement(
						mountedMeasurement.mounted.start >=
							mountedMeasurement.mounted.end
							? "virtualScroll.sameMountedWindowHit.empty"
							: "virtualScroll.sameMountedWindowHit.nonEmpty",
					);
				}
				// Active-scroll preview follows mounted-window publications. Idle
				// measurement normalizes it to the current viewport afterward.
				lastMountedScrollWindow = updateMountedScrollWindow(
					lastMountedScrollWindow,
					mountedMeasurement.identity,
					mountedMeasurement.mounted,
					mountedMeasurement.stableMountedScrollTopBand,
					mountedMeasurement.mountedCoverageScrollTopBand,
				);
				return returnStableScrollMeasurement(nextMeasurement, context);
			}

			pendingMountedMeasurement = mountedMeasurement;
			precomputedRanges = resolveScrollWindowMeasurement(
				nextMeasurement,
				context,
				mountedMeasurement.mounted,
			).ranges;
		} else {
			lastMountedScrollWindow = null;
		}

		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualScroll.rangeMeasurementApplied");
		}

		const result = applyRangeMeasurement(
			nextMeasurement,
			context,
			precomputedRanges,
		);
		if (process.env.NODE_ENV !== "production" && result.kind === "stable") {
			// "changed" means the mounted build was actually recomputed; a reused
			// build is counted separately so the counters stay interpretable.
			recordCCLDevMeasurement(
				result.updateKind === "reused"
					? "virtualScroll.rangeMeasurementReused"
					: "virtualScroll.rangeMeasurementChanged",
			);
		}

		if (result.kind !== "stable") {
			lastMountedScrollWindow = pendingMountedMeasurement
				? createMountedScrollWindow(
						pendingMountedMeasurement.identity,
						pendingMountedMeasurement.mounted,
						pendingMountedMeasurement.stableMountedScrollTopBand,
						pendingMountedMeasurement.mountedCoverageScrollTopBand,
					)
				: null;
			return toApplicationResult(result);
		}

		if (pendingMountedMeasurement) {
			lastMountedScrollWindow = updateMountedScrollWindow(
				lastMountedScrollWindow,
				pendingMountedMeasurement.identity,
				pendingMountedMeasurement.mounted,
				pendingMountedMeasurement.stableMountedScrollTopBand,
				pendingMountedMeasurement.mountedCoverageScrollTopBand,
			);
		} else {
			lastMountedScrollWindow = null;
		}
		if (!nextMeasurement.isScrollActive) {
			primeLastScrollWindow(nextMeasurement, context);
		}
		onStableMeasurement(nextMeasurement, context);
		return "stable";
	};

	return {
		applyScrollMeasurement,
		getScrollMeasurementRange,
		primeLastScrollWindow,
		resetLastScrollWindow,
	};
}
