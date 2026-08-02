import { CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES } from "../cardVirtualListPolicy";
import { createVirtualScrollWindowRangeResolver } from "../core/scrollWindowMeasurement";
import type { VirtualVisibilityPolicy } from "../core/virtualListEngine";
import type { MeasurementUpdateResult } from "../dom/virtualListMeasurementAdapter";
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
import type { FlatLinkRowModel } from "../row-models/flatLinkRowModel";
import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";
import { createVirtualScrollWindowMeasurementController } from "./virtualScrollWindowMeasurementController";

interface FlatGridMeasurement<T> {
	rowModel: FlatLinkRowModel<T>;
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isStableMeasurement: boolean;
	isScrollActive: boolean;
	precomputedRanges?: VirtualRanges;
	visibilityPolicy: VirtualVisibilityPolicy;
}

interface CreateFlatGridControllerAdapterOptions<T> {
	getRootEl(): HTMLElement | null;
	measurement: VirtualListMeasurementStateHandle;
	getLayout(): VirtualGridLayout;
	setLayout(layout: VirtualGridLayout): void;
	getConfiguredCardLayout(): ConfiguredCardLayout | null;
	getLogicalCellCount(): number;
	getItemCount(): number;
	resolveRowModel(layout: VirtualGridLayout): FlatLinkRowModel<T>;
	resolveVisibilityPolicy(layout: VirtualGridLayout): VirtualVisibilityPolicy;
	applyVirtualListMeasurement(
		measurement: FlatGridMeasurement<T>,
	): MeasurementUpdateResult<RowRange>;
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
	resolveRowModel,
	resolveVisibilityPolicy,
	applyVirtualListMeasurement,
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
	const rangeResolver = createVirtualScrollWindowRangeResolver<
		FlatLinkRowModel<T>,
		VirtualGridLayout
	>({
		resolveRowModel,
		resolveVisibilityPolicy,
		resolveStableMountedScrollTopBand: true,
	});
	const applyRangeMeasurement = (
		nextMeasurement: VirtualMeasurement,
		nextLayout: VirtualGridLayout,
		precomputedRanges?: VirtualRanges,
	): MeasurementUpdateResult<RowRange> =>
		applyVirtualListMeasurement({
			rowModel: resolveRowModel(nextLayout),
			scrollTop: nextMeasurement.scrollTop,
			viewportHeight: nextMeasurement.viewportHeight,
			sectionTop: nextMeasurement.sectionTop,
			isStableMeasurement: nextMeasurement.isStableMeasurement,
			isScrollActive: nextMeasurement.isScrollActive,
			precomputedRanges,
			visibilityPolicy: resolveVisibilityPolicy(nextLayout),
		});

	const scrollWindowMeasurementController =
		createVirtualScrollWindowMeasurementController<VirtualGridLayout>({
			resolveMountedScrollWindowMeasurement(measurement, layout) {
				return rangeResolver.resolveMountedScrollWindowMeasurement(
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
				return rangeResolver.resolveScrollWindowMeasurement(
					measurement.scrollTop,
					measurement.viewportHeight,
					measurement.sectionTop,
					layout,
					precomputedMountedRange,
				);
			},
			applyRangeMeasurement(measurement, layout, precomputedRanges) {
				return applyRangeMeasurement(measurement, layout, precomputedRanges);
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

		const result = applyRangeMeasurement(
			{ ...nextMeasurement, isScrollActive: false },
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
