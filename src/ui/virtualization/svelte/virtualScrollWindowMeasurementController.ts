import type { MeasurementUpdateResult } from "../dom/virtualListMeasurementAdapter";
import type {
	VirtualMeasurement,
	VirtualMeasurementApplicationResult,
} from "../dom/virtualMeasurementController";
import {
	createMountedScrollWindow,
	isSameMountedScrollWindow,
	isSameRangedScrollWindow,
	isWithinStableMountedScrollWindow,
	isWithinStablePreviewScrollWindow,
	type LastScrollWindow,
	type MountedScrollWindowMeasurement,
	type RangedScrollWindowMeasurement,
	type ScrollMeasurementRange,
	updateMountedAndPreviewScrollWindow,
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
	syncPreviewRange(ranges: VirtualRanges): void;
	onStableMeasurement(measurement: VirtualMeasurement, context: TContext): void;
}

export function createVirtualScrollWindowMeasurementController<TContext>({
	applyUnstableScrollMeasurement = true,
	resolveMountedScrollWindowMeasurement,
	resolveScrollWindowMeasurement,
	applyRangeMeasurement,
	syncPreviewRange,
	onStableMeasurement,
}: CreateVirtualScrollWindowMeasurementControllerOptions<TContext>) {
	let lastScrollWindow: LastScrollWindow | null = null;
	let lastStableScrollTop: number | null = null;
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
		lastScrollWindow = null;
		lastStableScrollTop = null;
	};

	const getScrollMeasurementRange = (): ScrollMeasurementRange | null => {
		if (!lastScrollWindow || lastStableScrollTop === null) {
			return null;
		}

		const isWithinMountedBand =
			lastStableScrollTop > lastScrollWindow.stableMountedScrollTopMin &&
			lastStableScrollTop < lastScrollWindow.stableMountedScrollTopMax;
		const isWithinPreviewBand =
			lastStableScrollTop > lastScrollWindow.stablePreviewScrollTopMin &&
			lastStableScrollTop < lastScrollWindow.stablePreviewScrollTopMax;
		if (!isWithinMountedBand && !isWithinPreviewBand) {
			return null;
		}

		scrollMeasurementRange.minScrollTopBeforeMeasurement = isWithinMountedBand
			? lastScrollWindow.stableMountedScrollTopMin
			: lastScrollWindow.stablePreviewScrollTopMin;
		scrollMeasurementRange.maxScrollTopBeforeMeasurement = isWithinMountedBand
			? lastScrollWindow.stableMountedScrollTopMax
			: lastScrollWindow.stablePreviewScrollTopMax;

		if (isWithinPreviewBand) {
			scrollMeasurementRange.minScrollTopBeforeMeasurement = Math.min(
				scrollMeasurementRange.minScrollTopBeforeMeasurement,
				lastScrollWindow.stablePreviewScrollTopMin,
			);
			scrollMeasurementRange.maxScrollTopBeforeMeasurement = Math.max(
				scrollMeasurementRange.maxScrollTopBeforeMeasurement,
				lastScrollWindow.stablePreviewScrollTopMax,
			);
		}

		return scrollMeasurementRange;
	};

	const primeLastScrollWindow = (
		measurement: VirtualMeasurement,
		context: TContext,
	): void => {
		if (!measurement.isStableMeasurement) {
			lastScrollWindow = null;
			return;
		}

		const mountedScrollWindowMeasurement = resolveMountedScrollWindowMeasurement(
			measurement,
			context,
		);
		lastScrollWindow = createMountedScrollWindow(
			mountedScrollWindowMeasurement.identity,
			mountedScrollWindowMeasurement.mounted,
			mountedScrollWindowMeasurement.stableMountedScrollTopBand,
		);
		lastStableScrollTop = measurement.scrollTop;
	};

	const returnStableScrollMeasurement = (
		measurement: VirtualMeasurement,
		context: TContext,
	): VirtualMeasurementApplicationResult => {
		lastStableScrollTop = measurement.scrollTop;
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
			lastScrollWindow = null;
			lastStableScrollTop = null;
			return "unstable";
		}

		let pendingMountedScrollWindowMeasurement: MountedScrollWindowMeasurement | null =
			null;
		let nextScrollWindowIdentity: RangedScrollWindowMeasurement["identity"] | null =
			null;
		let nextScrollWindowRanges: RangedScrollWindowMeasurement["ranges"] | null =
			null;
		let nextStablePreviewScrollTopBand:
			| RangedScrollWindowMeasurement["stablePreviewScrollTopBand"]
			| undefined;
		let nextStableMountedScrollTopBand:
			| MountedScrollWindowMeasurement["stableMountedScrollTopBand"]
			| undefined;
		let precomputedMountedRange: RowRange | undefined;
		let precomputedRanges: VirtualRanges | undefined;

		if (nextMeasurement.isStableMeasurement && nextMeasurement.isScrollActive) {
			const mountedScrollWindowMeasurement =
				resolveMountedScrollWindowMeasurement(nextMeasurement, context);
			precomputedMountedRange = mountedScrollWindowMeasurement.mounted;
			if (
				isSameMountedScrollWindow(
					lastScrollWindow,
					mountedScrollWindowMeasurement.identity,
					mountedScrollWindowMeasurement.mounted,
				) &&
				(isWithinStableMountedScrollWindow(
					lastScrollWindow,
					mountedScrollWindowMeasurement.identity,
					mountedScrollWindowMeasurement.mounted,
					nextMeasurement.scrollTop,
				) ||
					isWithinStablePreviewScrollWindow(
						lastScrollWindow,
						mountedScrollWindowMeasurement.identity,
						mountedScrollWindowMeasurement.mounted,
						nextMeasurement.scrollTop,
					))
			) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.stableBandHit");
				}
				return returnStableScrollMeasurement(nextMeasurement, context);
			}
			pendingMountedScrollWindowMeasurement = mountedScrollWindowMeasurement;

			const scrollWindowMeasurement = resolveScrollWindowMeasurement(
				nextMeasurement,
				context,
				precomputedMountedRange,
			);
			precomputedRanges = scrollWindowMeasurement.ranges;
			if (
				isSameRangedScrollWindow(
					lastScrollWindow,
					scrollWindowMeasurement.identity,
					scrollWindowMeasurement.ranges,
					"visible-and-mounted",
				)
			) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.stableBandHit");
				}
				return returnStableScrollMeasurement(nextMeasurement, context);
			}
			if (
				isSameMountedScrollWindow(
					lastScrollWindow,
					scrollWindowMeasurement.identity,
					scrollWindowMeasurement.ranges.mounted,
				)
			) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.previewOnlyCrossing");
				}
				syncPreviewRange(scrollWindowMeasurement.ranges);
				lastScrollWindow = updateMountedAndPreviewScrollWindow(
					lastScrollWindow,
					scrollWindowMeasurement.identity,
					scrollWindowMeasurement.ranges,
					scrollWindowMeasurement.stablePreviewScrollTopBand,
					pendingMountedScrollWindowMeasurement.stableMountedScrollTopBand,
				);
				return returnStableScrollMeasurement(nextMeasurement, context);
			}

			nextScrollWindowIdentity = scrollWindowMeasurement.identity;
			nextScrollWindowRanges = scrollWindowMeasurement.ranges;
			nextStablePreviewScrollTopBand =
				scrollWindowMeasurement.stablePreviewScrollTopBand;
			if (
				pendingMountedScrollWindowMeasurement.identity ===
					scrollWindowMeasurement.identity &&
				pendingMountedScrollWindowMeasurement.mounted.start ===
					scrollWindowMeasurement.ranges.mounted.start &&
				pendingMountedScrollWindowMeasurement.mounted.end ===
					scrollWindowMeasurement.ranges.mounted.end
			) {
				nextStableMountedScrollTopBand =
					pendingMountedScrollWindowMeasurement.stableMountedScrollTopBand;
			}
		} else {
			lastScrollWindow = null;
		}

		const result = applyRangeMeasurement(
			nextMeasurement,
			context,
			precomputedRanges,
		);
		if (result.kind !== "stable") {
			lastStableScrollTop = null;
			if (lastScrollWindow === null && pendingMountedScrollWindowMeasurement) {
				lastScrollWindow = createMountedScrollWindow(
					pendingMountedScrollWindowMeasurement.identity,
					pendingMountedScrollWindowMeasurement.mounted,
					pendingMountedScrollWindowMeasurement.stableMountedScrollTopBand,
				);
			} else {
				lastScrollWindow = null;
			}
			return toApplicationResult(result);
		}

		if (nextScrollWindowIdentity === null) {
			lastScrollWindow = null;
		} else if (nextScrollWindowRanges) {
			lastScrollWindow = updateMountedAndPreviewScrollWindow(
				lastScrollWindow,
				nextScrollWindowIdentity,
				nextScrollWindowRanges,
				nextStablePreviewScrollTopBand,
				nextStableMountedScrollTopBand,
			);
		}
		if (!nextMeasurement.isScrollActive) {
			primeLastScrollWindow(nextMeasurement, context);
		}
		lastStableScrollTop = nextMeasurement.scrollTop;
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
