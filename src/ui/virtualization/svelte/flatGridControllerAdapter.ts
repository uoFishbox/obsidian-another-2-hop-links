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
import type { createFlatGridMeasurementAdapter } from "./flatGridMeasurementAdapter";
import { createVirtualScrollWindowMeasurementController } from "./virtualScrollWindowMeasurementController";

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
	const stableMeasurementContext: VirtualListStableMeasurementContext = {
		scrollTop: 0,
		viewportHeight: 0,
		sectionTop: 0,
		isScrollActive: false,
		sharedScrollMetrics: undefined,
	};

	const notifyStableMeasurement = (measurement: VirtualMeasurement): void => {
		stableMeasurementContext.scrollTop = measurement.scrollTop;
		stableMeasurementContext.viewportHeight = measurement.viewportHeight;
		stableMeasurementContext.sectionTop = measurement.sectionTop;
		stableMeasurementContext.isScrollActive = measurement.isScrollActive;
		stableMeasurementContext.sharedScrollMetrics = measurement.sharedScrollMetrics;
		onStableMeasurement(stableMeasurementContext);
	};

	const scrollWindowMeasurementController =
		createVirtualScrollWindowMeasurementController<VirtualGridLayout>({
			resolveMountedScrollWindowMeasurement(measurement, layout) {
				return measurementAdapter.resolveMountedScrollWindowMeasurement(
					measurement.scrollTop,
					measurement.viewportHeight,
					measurement.sectionTop,
					layout,
				);
			},
			resolveScrollWindowMeasurement(
				measurement,
				layout,
				precomputedMountedRange,
			) {
				return measurementAdapter.resolveScrollWindowMeasurement(
					measurement.scrollTop,
					measurement.viewportHeight,
					measurement.sectionTop,
					layout,
					precomputedMountedRange,
				);
			},
			applyRangeMeasurement(measurement, layout, precomputedRanges) {
				return measurementAdapter.applyRangeMeasurement(
					measurement.scrollTop,
					measurement.viewportHeight,
					measurement.sectionTop,
					measurement.isStableMeasurement,
					measurement.isScrollActive,
					layout,
					precomputedRanges,
				);
			},
			onStableMeasurement(measurement) {
				notifyStableMeasurement(measurement);
			},
		});

	const applyLayoutMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		const rootEl = getRootEl();
		if (!rootEl || !nextMeasurement.sectionRect) {
			scrollWindowMeasurementController.resetLastScrollWindow();
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
			scrollWindowMeasurementController.resetLastScrollWindow();
			return "unstable";
		}

		scrollWindowMeasurementController.primeLastScrollWindow(
			nextMeasurement,
			layoutMeasurement.layout,
		);
		measurementController.scheduleScrollMeasurementAfterLayout(nextMeasurement);
		notifyStableMeasurement(nextMeasurement);
		return "stable";
	};

	const applyScrollMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		return scrollWindowMeasurementController.applyScrollMeasurement(
			nextMeasurement,
			getLayout(),
		);
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
		getScrollMeasurementRange:
			scrollWindowMeasurementController.getScrollMeasurementRange,
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
		updateFromCachedMeasurement(
			metrics?: Parameters<typeof measurementController.runScrollMeasurement>[0],
		): void {
			measurementController.runScrollMeasurement(metrics);
		},
	};
}
