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
	type StableScrollTopBand,
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
	const publishedCoverageBand: {
		-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
	} = {
		min: 0,
		max: 0,
	};

	const toApplicationResult = (
		result: MeasurementUpdateResult<RowRange>,
	): VirtualMeasurementApplicationResult =>
		result.kind === "stable" ? "stable" : "unstable";

	const resetLastScrollWindow = (): void => {
		lastMountedScrollWindow = null;
	};

	const resolvePublishedCoverageBand = (
		mountedMeasurement: MountedScrollWindowMeasurement,
		rangedMeasurement: RangedScrollWindowMeasurement,
	): StableScrollTopBand | undefined => {
		const mountedBand = mountedMeasurement.mountedCoverageScrollTopBand;
		const previewBand = rangedMeasurement.previewCoverageScrollTopBand;
		if (
			!mountedBand ||
			!previewBand ||
			mountedMeasurement.identity !== rangedMeasurement.identity ||
			mountedMeasurement.mounted.start !==
				rangedMeasurement.ranges.mounted.start ||
			mountedMeasurement.mounted.end !== rangedMeasurement.ranges.mounted.end ||
			rangedMeasurement.ranges.previewVisible.start <
				rangedMeasurement.ranges.mounted.start ||
			rangedMeasurement.ranges.previewVisible.end >
				rangedMeasurement.ranges.mounted.end
		) {
			return undefined;
		}

		publishedCoverageBand.min = Math.max(mountedBand.min, previewBand.min);
		publishedCoverageBand.max = Math.min(mountedBand.max, previewBand.max);
		return publishedCoverageBand.min < publishedCoverageBand.max
			? publishedCoverageBand
			: undefined;
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
		const rangedMeasurement = resolveScrollWindowMeasurement(
			measurement,
			context,
			mountedMeasurement.mounted,
		);
		lastMountedScrollWindow = createMountedScrollWindow(
			mountedMeasurement.identity,
			mountedMeasurement.mounted,
			mountedMeasurement.stableMountedScrollTopBand,
			resolvePublishedCoverageBand(mountedMeasurement, rangedMeasurement),
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
		let pendingRangedMeasurement: RangedScrollWindowMeasurement | null = null;
		let precomputedRanges: VirtualRanges | undefined;

		if (nextMeasurement.isStableMeasurement && nextMeasurement.isScrollActive) {
			const mountedMeasurement = resolveMountedScrollWindowMeasurement(
				nextMeasurement,
				context,
			);
			const isStableMountedWindow = isWithinStableMountedScrollWindow(
				lastMountedScrollWindow,
				mountedMeasurement.identity,
				mountedMeasurement.mounted,
				nextMeasurement.scrollTop,
			);
			const isSameMountedWindow = isSameMountedScrollWindow(
				lastMountedScrollWindow,
				mountedMeasurement.identity,
				mountedMeasurement.mounted,
			);
			if (isStableMountedWindow) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.stableBandHit");
				}
			} else if (isSameMountedWindow) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.sameMountedWindowHit");
					recordCCLDevMeasurement(
						mountedMeasurement.mounted.start >=
							mountedMeasurement.mounted.end
							? "virtualScroll.sameMountedWindowHit.empty"
							: "virtualScroll.sameMountedWindowHit.nonEmpty",
					);
				}
			}

			pendingMountedMeasurement = mountedMeasurement;
			pendingRangedMeasurement = resolveScrollWindowMeasurement(
				nextMeasurement,
				context,
				mountedMeasurement.mounted,
			);
			precomputedRanges = pendingRangedMeasurement.ranges;
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
			if (result.kind === "skipped") {
				lastMountedScrollWindow = null;
				return toApplicationResult(result);
			}
			lastMountedScrollWindow = pendingMountedMeasurement
				? createMountedScrollWindow(
						pendingMountedMeasurement.identity,
						pendingMountedMeasurement.mounted,
						pendingMountedMeasurement.stableMountedScrollTopBand,
						pendingRangedMeasurement
							? resolvePublishedCoverageBand(
									pendingMountedMeasurement,
									pendingRangedMeasurement,
								)
							: undefined,
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
				pendingRangedMeasurement
					? resolvePublishedCoverageBand(
							pendingMountedMeasurement,
							pendingRangedMeasurement,
						)
					: undefined,
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
