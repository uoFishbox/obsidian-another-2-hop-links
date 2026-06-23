import { untrack } from "svelte";
import type { SectionRenderDescriptor } from "../../../sections/types";
import { CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES } from "../cardVirtualListPolicy";
import { createVirtualListController } from "../dom/virtualListController";
import { resolveCachedCardGridLayoutBase } from "../dom/virtualListCardLayout";
import { createVirtualListMeasurementState } from "../dom/virtualListMeasurementState";
import { resolveVirtualListLayoutStability } from "../dom/virtualListMeasurementStability";
import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";
import type { StablePreviewScrollTopBand } from "../dom/activeScrollWindowGate";
import { resolveCardLayoutSettings } from "ui/utils/cardLayoutCssVars";
import type { ViewPlanCardVirtualListPolicyResolver } from "./viewPlanPolicy";
import {
	DEFAULT_VIEW_PLAN_CARD_LAYOUT,
	DEFAULT_VIEW_PLAN_LAYOUT,
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "./viewPlanLayout";

type ConfiguredCardLayout = ReturnType<typeof resolveCardLayoutSettings>;
interface MeasuredViewPlanRowModel {
	readonly rowCount: number;
	findVisibleRange(params: {
		scrollTop: number;
		viewportHeight: number;
		overscanPx: number;
	}): RowRange;
	findVisibleRangeInto(
		out: RowRange,
		params: {
			scrollTop: number;
			viewportHeight: number;
			overscanPx: number;
		},
	): void;
	findVisibleRanges(params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
	findVisibleRangesInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
	findVisibleRangesFromMounted(params: {
		scrollTop: number;
		viewportHeight: number;
		mounted: RowRange;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
	findVisibleRangesFromMountedInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mounted: RowRange;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
	findStablePreviewScrollTopBandInto(
		out: StablePreviewScrollTopBandMutable,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
			previewVisible: RowRange;
		},
	): void;
}

type StablePreviewScrollTopBandMutable = {
	-readonly [K in keyof StablePreviewScrollTopBand]: StablePreviewScrollTopBand[K];
};

interface MeasuredViewPlanRuntime<T, G, TRowModel extends MeasuredViewPlanRowModel> {
	readonly rowModel: TRowModel;
	readonly virtualList: {
		applyMeasurement(params: {
			rowModel: TRowModel;
			scrollTop: number;
			viewportHeight: number;
			sectionTop: number;
			isStableMeasurement: boolean;
			isScrollActive: boolean;
			hasStableVisibleRange: boolean;
			precomputedRanges?: VirtualRanges;
			visibilityPolicy: ReturnType<
				ViewPlanCardVirtualListPolicyResolver["resolve"]
			>;
		}): import("../dom/virtualListMeasurementAdapter").MeasurementUpdateResult<RowRange>;
	};
	resolveRowModel(layout: ViewPlanLayoutMetrics): TRowModel;
	syncPreviewVisibleRange(start: number, end: number): void;
	cancelPreviewVisibleRangeSync(): void;
}

export function createViewPlanMeasurementState() {
	let rootEl = $state<HTMLDivElement | null>(null);
	let measurement = $state(createVirtualListMeasurementState());
	let layout = $state.raw(DEFAULT_VIEW_PLAN_LAYOUT);

	return {
		get rootEl() {
			return rootEl;
		},
		set rootEl(nextRootEl: HTMLDivElement | null) {
			rootEl = nextRootEl;
		},
		get measurement() {
			return measurement;
		},
		get layout() {
			return layout;
		},
		setLayout(nextLayout: ViewPlanLayoutMetrics) {
			layout = nextLayout;
		},
	};
}

export function createViewPlanMeasurementRuntime<
	T,
	G,
	TRowModel extends MeasuredViewPlanRowModel,
>(params: {
	state: ReturnType<typeof createViewPlanMeasurementState>;
	runtime: MeasuredViewPlanRuntime<T, G, TRowModel>;
	getConfiguredCardLayout(): ConfiguredCardLayout | null;
	getValidatedSections(): readonly SectionRenderDescriptor<T, G>[];
	policyResolver: ViewPlanCardVirtualListPolicyResolver;
}) {
	let hasObservedInitialLayout = $state(false);
	let hasConsumedInitialCardLayoutEffect = false;
	let initialObservedCardLayout: ConfiguredCardLayout | null | undefined = undefined;
	const mountedRangeParams: Parameters<TRowModel["findVisibleRange"]>[0] = {
		scrollTop: 0,
		viewportHeight: 0,
		overscanPx: 0,
	};
	const rangeParams: Parameters<TRowModel["findVisibleRanges"]>[0] = {
		scrollTop: 0,
		viewportHeight: 0,
		mountedOverscanPx: 0,
		previewOverscanPx: 0,
	};
	const rangesFromMountedParams: Parameters<
		TRowModel["findVisibleRangesFromMounted"]
	>[0] = {
		scrollTop: 0,
		viewportHeight: 0,
		mounted: { start: 0, end: 0 },
		mountedOverscanPx: 0,
		previewOverscanPx: 0,
	};
	const mountedScrollWindowMeasurement = {
		identity: params.runtime.rowModel,
		mounted: { start: 0, end: 0 },
	};
	const scrollWindowMeasurement = {
		identity: params.runtime.rowModel,
		ranges: {
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		},
		stablePreviewScrollTopBand: { min: 0, max: 0 },
	};
	const committedScrollWindowMeasurement = {
		identity: params.runtime.rowModel,
		ranges: {
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		},
		stablePreviewScrollTopBand: { min: 0, max: 0 },
	};
	const updateVisibleFlatRowRangeFromMeasurement = (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		isStableMeasurement: boolean,
		isScrollActive: boolean,
		nextRowModel = params.runtime.rowModel,
		nextLayout = params.state.layout,
		precomputedRanges?: VirtualRanges,
	) => {
		return params.runtime.virtualList.applyMeasurement({
			rowModel: nextRowModel,
			scrollTop,
			viewportHeight,
			sectionTop,
			isStableMeasurement,
			isScrollActive,
			hasStableVisibleRange: params.state.measurement.hasStableVisibleRange,
			precomputedRanges,
			visibilityPolicy: params.policyResolver.resolve(nextLayout, isScrollActive),
		});
	};
	const updateStablePreviewScrollTopBand = (
		out: StablePreviewScrollTopBandMutable,
		measurementRowModel: TRowModel,
		sectionTop: number,
		rangeParams: Parameters<TRowModel["findVisibleRanges"]>[0],
		previewVisible: RowRange,
	): void => {
		measurementRowModel.findStablePreviewScrollTopBandInto(out, {
			scrollTop: rangeParams.scrollTop,
			viewportHeight: rangeParams.viewportHeight,
			mountedOverscanPx: rangeParams.mountedOverscanPx,
			previewOverscanPx: rangeParams.previewOverscanPx,
			previewVisible,
		});
		out.min += sectionTop;
		out.max += sectionTop;
	};

	const virtualListController = createVirtualListController<
		ViewPlanLayoutMetrics,
		TRowModel,
		{ allowUnstableBootstrap?: boolean } | undefined
	>({
		getRootEl: () => params.state.rootEl,
		measurement: params.state.measurement,
		getLayout: () => params.state.layout,
		setLayout: params.state.setLayout,
		isSameLayout: isSameViewPlanLayout,
		resolveLayoutMeasurement: (sectionEl, rootRect) => {
			const layoutBase = resolveCachedCardGridLayoutBase({
				rootEl: sectionEl,
				rootRect,
				measuredWidth: params.state.measurement.measuredWidth,
				defaults: DEFAULT_VIEW_PLAN_CARD_LAYOUT,
				listKind: "view-plan",
				scrollContainerEl: params.state.measurement.scrollContainerEl,
				configuredLayout: params.getConfiguredCardLayout(),
			});
			const nextLayout: ViewPlanLayoutMetrics = {
				containerWidth: layoutBase.containerWidth,
				columns: layoutBase.columns,
				cellWidth: layoutBase.cellWidth,
				rowHeight: layoutBase.rowHeight,
				gap: layoutBase.gap,
				sectionMarginBottom: Math.max(
					0,
					layoutBase.cardLayout.sectionMarginBottomPx,
				),
			};
			const nextRowModel = params.runtime.resolveRowModel(nextLayout);
			const hasRenderableSections = params.getValidatedSections().length > 0;
			const layoutStability = resolveVirtualListLayoutStability({
				rootEl: sectionEl,
				rootRect,
				measuredWidth: params.state.measurement.measuredWidth,
				hasRenderableContent: hasRenderableSections,
			});

			return {
				layout: nextLayout,
				content: nextRowModel,
				hasRenderableContent: nextRowModel.rowCount > 0,
				hasStableLayout: layoutStability.isStable,
			};
		},
		getCachedContent: () => params.runtime.rowModel,
		hasRenderableContent: (nextRowModel) => nextRowModel.rowCount > 0,
		applyRangeMeasurement: ({
			scrollTop,
			viewportHeight,
			sectionTop,
			isStableMeasurement,
			isScrollActive,
			content: nextRowModel,
			layout: nextLayout,
			precomputedRanges,
		}) =>
			updateVisibleFlatRowRangeFromMeasurement(
				scrollTop,
				viewportHeight,
				sectionTop,
				isStableMeasurement,
				isScrollActive,
				nextRowModel,
				nextLayout,
				precomputedRanges,
			),
		resolveMountedScrollWindowMeasurement: (
			scrollTop,
			viewportHeight,
			sectionTop,
			measurementRowModel,
			nextLayout,
		) => {
			const visibilityPolicy = params.policyResolver.resolve(nextLayout, true);
			mountedRangeParams.scrollTop = scrollTop - sectionTop;
			mountedRangeParams.viewportHeight = viewportHeight;
			mountedRangeParams.overscanPx = visibilityPolicy.mountedOverscanPx;
			mountedScrollWindowMeasurement.identity = measurementRowModel;
			measurementRowModel.findVisibleRangeInto(
				mountedScrollWindowMeasurement.mounted,
				mountedRangeParams,
			);
			return mountedScrollWindowMeasurement;
		},
		resolveScrollWindowMeasurement: (
			scrollTop,
			viewportHeight,
			sectionTop,
			measurementRowModel,
			nextLayout,
			precomputedMountedRange,
			hasMountedWindowChanged,
		) => {
			const visibilityPolicy = params.policyResolver.resolve(nextLayout, true);
			rangeParams.scrollTop = scrollTop - sectionTop;
			rangeParams.viewportHeight = viewportHeight;
			rangeParams.mountedOverscanPx = visibilityPolicy.mountedOverscanPx;
			rangeParams.previewOverscanPx = visibilityPolicy.previewOverscanPx;
			if (!precomputedMountedRange || hasMountedWindowChanged) {
				committedScrollWindowMeasurement.identity = measurementRowModel;
				measurementRowModel.findVisibleRangesInto(
					committedScrollWindowMeasurement.ranges,
					rangeParams,
				);
				updateStablePreviewScrollTopBand(
					committedScrollWindowMeasurement.stablePreviewScrollTopBand,
					measurementRowModel,
					sectionTop,
					rangeParams,
					committedScrollWindowMeasurement.ranges.previewVisible,
				);
				return committedScrollWindowMeasurement;
			}

			scrollWindowMeasurement.identity = measurementRowModel;
			rangesFromMountedParams.scrollTop = rangeParams.scrollTop;
			rangesFromMountedParams.viewportHeight = rangeParams.viewportHeight;
			rangesFromMountedParams.mounted = precomputedMountedRange;
			rangesFromMountedParams.mountedOverscanPx = rangeParams.mountedOverscanPx;
			rangesFromMountedParams.previewOverscanPx = rangeParams.previewOverscanPx;
			measurementRowModel.findVisibleRangesFromMountedInto(
				scrollWindowMeasurement.ranges,
				rangesFromMountedParams,
			);
			updateStablePreviewScrollTopBand(
				scrollWindowMeasurement.stablePreviewScrollTopBand,
				measurementRowModel,
				sectionTop,
				rangeParams,
				scrollWindowMeasurement.ranges.previewVisible,
			);
			return scrollWindowMeasurement;
		},
		onActiveScrollPreviewRangeMeasurement: (ranges) => {
			params.runtime.syncPreviewVisibleRange(
				ranges.previewVisible.start,
				ranges.previewVisible.end,
			);
		},
		activeScrollWindowComparison: "mounted-only",
		shouldSkipUnstableCachedMeasurement: (options) =>
			!options?.allowUnstableBootstrap,
		maxUnstableMeasurementRetries:
			CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES,
	});

	const scheduleLayoutMeasurementForCardLayout = (
		nextCardLayout: ConfiguredCardLayout | null,
	): void => {
		if (!params.state.rootEl || !hasObservedInitialLayout) {
			return;
		}

		if (!hasConsumedInitialCardLayoutEffect) {
			hasConsumedInitialCardLayoutEffect = true;
			if (nextCardLayout === initialObservedCardLayout) {
				return;
			}
		}

		virtualListController.scheduleLayoutMeasurement();
	};

	const updateCachedMeasurementForDataChange = (): void => {
		const nextLayout = untrack(() => params.state.layout);
		if (virtualListController.hasPendingLayoutMeasurement()) {
			return;
		}

		const nextRowModel = params.runtime.resolveRowModel(nextLayout);
		virtualListController.updateFromCachedMeasurement(nextRowModel, {
			allowUnstableBootstrap: false,
		});
	};

	const observeRootElement = (): (() => void) | undefined => {
		if (!params.state.rootEl || typeof window === "undefined") {
			return;
		}

		hasObservedInitialLayout = false;
		hasConsumedInitialCardLayoutEffect = false;
		initialObservedCardLayout = untrack(params.getConfiguredCardLayout);

		const stopObserving = virtualListController.observeRoot(
			params.state.rootEl,
			(callback) => {
				untrack(callback);
			},
		);
		hasObservedInitialLayout = true;

		return () => {
			hasObservedInitialLayout = false;
			hasConsumedInitialCardLayoutEffect = false;
			initialObservedCardLayout = undefined;
			params.runtime.cancelPreviewVisibleRangeSync();
			stopObserving();
		};
	};

	const flushVirtualScrollMeasurement = (
		scrollContainerEl: HTMLElement | null,
		targetTop: number,
	): void => {
		const measurement = params.state.measurement;
		if (measurement.scrollContainerEl !== scrollContainerEl) {
			measurement.scrollContainerEl = scrollContainerEl;
		}
		if (scrollContainerEl && scrollContainerEl.clientHeight > 0) {
			measurement.viewportHeight = scrollContainerEl.clientHeight;
			measurement.sectionTop = Math.max(
				0,
				scrollContainerEl.scrollTop - targetTop,
			);
			measurement.hasStableScrollMetrics = true;
		}
		virtualListController.updateFromCachedMeasurement();
	};

	return {
		scheduleLayoutMeasurementForCardLayout,
		updateCachedMeasurementForDataChange,
		observeRootElement,
		flushVirtualScrollMeasurement,
	};
}
