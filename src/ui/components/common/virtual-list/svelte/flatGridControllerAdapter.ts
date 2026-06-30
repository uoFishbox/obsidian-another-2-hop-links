import { CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES } from "../cardVirtualListPolicy";
import type { VirtualListMeasurementStateHandle } from "../dom/virtualListMeasurementState";
import {
	createVirtualMeasurementController,
	type VirtualListStableMeasurementContext,
	type VirtualMeasurement,
	type VirtualMeasurementApplicationResult,
} from "../dom/virtualMeasurementController";
import {
	isSameFlatGridLayout,
	resolveFlatGridLayoutMeasurement,
	type ConfiguredCardLayout,
	type VirtualGridLayout,
} from "../dom/flatGridLayoutMeasurement";
import type { MeasurementUpdateResult } from "../dom/virtualListMeasurementAdapter";
import {
	createMountedScrollWindow,
	isSameMountedScrollWindow,
	isSameRangedScrollWindow,
	isWithinStableMountedScrollWindow,
	isWithinStablePreviewScrollWindow,
	type LastScrollWindow,
	type MountedScrollWindowMeasurement,
	type RangedScrollWindowMeasurement,
	updateMountedAndPreviewScrollWindow,
} from "../core/scrollWindowGate";
import type { RowRange } from "../rowRange";
import type { createFlatGridMeasurementAdapter } from "./flatGridMeasurementAdapter";

export interface CreateFlatGridControllerAdapterOptions<T> {
	getRootEl(): HTMLElement | null;
	measurement: VirtualListMeasurementStateHandle;
	getLayout(): VirtualGridLayout;
	setLayout(layout: VirtualGridLayout): void;
	getConfiguredCardLayout(): ConfiguredCardLayout | null;
	getLogicalCellCount(): number;
	getItemCount(): number;
	measurementAdapter: ReturnType<
		typeof createFlatGridMeasurementAdapter<T, VirtualGridLayout>
	>;
	onStableMeasurement(context: VirtualListStableMeasurementContext): void;
}

export function createFlatGridControllerAdapter<T>({
	getRootEl,
	measurement,
	getLayout,
	setLayout,
	getConfiguredCardLayout,
	getLogicalCellCount,
	getItemCount,
	measurementAdapter,
	onStableMeasurement,
}: CreateFlatGridControllerAdapterOptions<T>) {
	let lastScrollWindow: LastScrollWindow | null = null;
	const stableMeasurementContext: VirtualListStableMeasurementContext = {
		scrollTop: 0,
		viewportHeight: 0,
		sectionTop: 0,
		isScrollActive: false,
		sharedScrollMetrics: undefined,
	};

	const toApplicationResult = (
		result: MeasurementUpdateResult<RowRange>,
	): VirtualMeasurementApplicationResult =>
		result.kind === "stable" ? "stable" : "unstable";

	const notifyStableMeasurement = (measurement: VirtualMeasurement): void => {
		stableMeasurementContext.scrollTop = measurement.scrollTop;
		stableMeasurementContext.viewportHeight = measurement.viewportHeight;
		stableMeasurementContext.sectionTop = measurement.sectionTop;
		stableMeasurementContext.isScrollActive = measurement.isScrollActive;
		stableMeasurementContext.sharedScrollMetrics = measurement.sharedScrollMetrics;
		onStableMeasurement(stableMeasurementContext);
	};

	const primeLastScrollWindow = (
		measurement: VirtualMeasurement,
		layout: VirtualGridLayout,
	): void => {
		if (!measurement.isStableMeasurement) {
			lastScrollWindow = null;
			return;
		}

		const mountedScrollWindowMeasurement =
			measurementAdapter.resolveMountedScrollWindowMeasurement(
				measurement.scrollTop,
				measurement.viewportHeight,
				measurement.sectionTop,
				layout,
			);
		lastScrollWindow = createMountedScrollWindow(
			mountedScrollWindowMeasurement.identity,
			mountedScrollWindowMeasurement.mounted,
			mountedScrollWindowMeasurement.stableMountedScrollTopBand,
		);
	};

	const applyLayoutMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		const rootEl = getRootEl();
		if (!rootEl || !nextMeasurement.sectionRect) {
			lastScrollWindow = null;
			return "skipped";
		}

		const layoutMeasurement = resolveFlatGridLayoutMeasurement({
			rootEl,
			rootRect: nextMeasurement.sectionRect,
			measuredWidth: measurement.measuredWidth,
			scrollContainerEl: measurement.scrollContainerEl,
			configuredLayout: getConfiguredCardLayout(),
			logicalCellCount: getLogicalCellCount(),
			hasRenderableItems: getItemCount() > 0,
		});
		if (!isSameFlatGridLayout(getLayout(), layoutMeasurement.layout)) {
			setLayout(layoutMeasurement.layout);
		}

		const result = measurementAdapter.applyRangeMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			nextMeasurement.isStableMeasurement,
			false,
			layoutMeasurement.layout,
		);
		if (result.kind !== "stable" || !layoutMeasurement.hasStableLayout) {
			lastScrollWindow = null;
			return "unstable";
		}

		primeLastScrollWindow(nextMeasurement, layoutMeasurement.layout);
		measurementController.scheduleScrollMeasurement();
		notifyStableMeasurement(nextMeasurement);
		return "stable";
	};

	const returnStableScrollMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		notifyStableMeasurement(nextMeasurement);
		return "stable";
	};

	const applyScrollMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		const layout = getLayout();
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
		let precomputedRanges: RangedScrollWindowMeasurement["ranges"] | undefined;

		if (nextMeasurement.isStableMeasurement && nextMeasurement.isScrollActive) {
			const mountedScrollWindowMeasurement =
				measurementAdapter.resolveMountedScrollWindowMeasurement(
					nextMeasurement.scrollTop,
					nextMeasurement.viewportHeight,
					nextMeasurement.sectionTop,
					layout,
				);
			precomputedMountedRange = mountedScrollWindowMeasurement.mounted;
			if (
				isSameMountedScrollWindow(
					lastScrollWindow,
					mountedScrollWindowMeasurement.identity,
					mountedScrollWindowMeasurement.mounted,
				)
			) {
				if (
					isWithinStableMountedScrollWindow(
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
					)
				) {
					return returnStableScrollMeasurement(nextMeasurement);
				}
			}
			pendingMountedScrollWindowMeasurement = mountedScrollWindowMeasurement;

			const scrollWindowMeasurement =
				measurementAdapter.resolveScrollWindowMeasurement(
					nextMeasurement.scrollTop,
					nextMeasurement.viewportHeight,
					nextMeasurement.sectionTop,
					layout,
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
				return returnStableScrollMeasurement(nextMeasurement);
			}
			if (
				isSameMountedScrollWindow(
					lastScrollWindow,
					scrollWindowMeasurement.identity,
					scrollWindowMeasurement.ranges.mounted,
				)
			) {
				measurementAdapter.onActiveScrollPreviewRangeMeasurement(
					scrollWindowMeasurement.ranges,
				);
				lastScrollWindow = updateMountedAndPreviewScrollWindow(
					lastScrollWindow,
					scrollWindowMeasurement.identity,
					scrollWindowMeasurement.ranges,
					scrollWindowMeasurement.stablePreviewScrollTopBand,
					pendingMountedScrollWindowMeasurement.stableMountedScrollTopBand,
				);
				return returnStableScrollMeasurement(nextMeasurement);
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

		const result = measurementAdapter.applyRangeMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			nextMeasurement.isStableMeasurement,
			nextMeasurement.isScrollActive,
			layout,
			precomputedRanges,
		);
		if (result.kind !== "stable") {
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
			primeLastScrollWindow(nextMeasurement, layout);
		}
		notifyStableMeasurement(nextMeasurement);
		return "stable";
	};

	const applyMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult =>
		nextMeasurement.source === "layout"
			? applyLayoutMeasurement(nextMeasurement)
			: applyScrollMeasurement(nextMeasurement);

	const measurementController = createVirtualMeasurementController({
		getRootEl,
		measurement,
		hasRenderableContent: () => getItemCount() > 0,
		onMeasurement: applyMeasurement,
		enableBootstrapMeasurementSuppression: true,
		enableInitialStabilization: true,
		primeUnstableScrollStart: true,
		maxUnstableMeasurementRetries:
			CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES,
	});

	return {
		hasPendingLayoutMeasurement: measurementController.hasPendingLayoutMeasurement,
		observeRoot: measurementController.observeRoot,
		runLayoutMeasurement: measurementController.runLayoutMeasurement,
		runScrollMeasurement: measurementController.runScrollMeasurement,
		scheduleLayoutMeasurement: measurementController.scheduleLayoutMeasurement,
		scheduleScrollMeasurement: measurementController.scheduleScrollMeasurement,
		updateFromCachedMeasurement(): void {
			measurementController.runScrollMeasurement();
		},
	};
}
