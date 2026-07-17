import { untrack } from "svelte";
import type { SectionRenderDescriptor } from "../../../sections/types";
import { CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES } from "../cardVirtualListPolicy";
import {
	createVirtualMeasurementController,
	type VirtualMeasurement,
	type VirtualMeasurementApplicationResult,
} from "../dom/virtualMeasurementController";
import { flushVirtualScrollMeasurement as flushCachedVirtualScrollMeasurement } from "../dom/flushVirtualScrollMeasurement";
import { resolveCachedCardGridLayoutBase } from "../dom/virtualListCardLayout";
import { createVirtualListMeasurementState } from "../dom/virtualListMeasurementState";
import { resolveVirtualListLayoutStability } from "../dom/virtualListMeasurementStability";
import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";
import type {
	MountedScrollWindowMeasurement,
	RangedScrollWindowMeasurement,
} from "../core/scrollWindowGate";
import {
	createVirtualScrollWindowRangeResolver,
	type VirtualScrollWindowRangeRowModel,
} from "../core/scrollWindowMeasurement";
import { resolveCardLayoutSettings } from "ui/utils/cardLayoutCssVars";
import type {
	ViewPlanCardVirtualListPolicy,
	ViewPlanCardVirtualListPolicyResolver,
} from "./viewPlanPolicy";
import {
	DEFAULT_VIEW_PLAN_CARD_LAYOUT,
	DEFAULT_VIEW_PLAN_LAYOUT,
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "./viewPlanLayout";
import { createVirtualScrollWindowMeasurementController } from "./virtualScrollWindowMeasurementController";
import type { VirtualFrameCoordinator } from "ui/virtualization/frameCoordinator";

type ConfiguredCardLayout = ReturnType<typeof resolveCardLayoutSettings>;

interface MeasuredViewPlanRuntime<
	T,
	G,
	TRowModel extends VirtualScrollWindowRangeRowModel,
> {
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
	TRowModel extends VirtualScrollWindowRangeRowModel,
>(params: {
	state: ReturnType<typeof createViewPlanMeasurementState>;
	runtime: MeasuredViewPlanRuntime<T, G, TRowModel>;
	getConfiguredCardLayout(): ConfiguredCardLayout | null;
	getValidatedSections(): readonly SectionRenderDescriptor<T, G>[];
	policyResolver: ViewPlanCardVirtualListPolicyResolver;
	frameCoordinator?: VirtualFrameCoordinator;
}) {
	let hasObservedInitialLayout = $state(false);
	let hasConsumedInitialCardLayoutEffect = false;
	let initialObservedCardLayout: ConfiguredCardLayout | null | undefined = undefined;
	let lastResolvedActiveScrollPolicyLayout: ViewPlanLayoutMetrics | undefined;
	let lastResolvedActiveScrollPolicy: ViewPlanCardVirtualListPolicy | undefined;
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

	let cachedRowModelOverride: TRowModel | null = null;

	const resolveActiveScrollPolicy = (
		nextLayout: ViewPlanLayoutMetrics,
	): ViewPlanCardVirtualListPolicy => {
		if (lastResolvedActiveScrollPolicyLayout !== nextLayout) {
			lastResolvedActiveScrollPolicyLayout = nextLayout;
			lastResolvedActiveScrollPolicy = params.policyResolver.resolve(
				nextLayout,
				true,
			);
		}
		return lastResolvedActiveScrollPolicy!;
	};
	const rangeResolver = createVirtualScrollWindowRangeResolver<
		TRowModel,
		ViewPlanLayoutMetrics
	>({
		resolveRowModel: params.runtime.resolveRowModel,
		resolveVisibilityPolicy: resolveActiveScrollPolicy,
		resolveStableMountedScrollTopBand: true,
	});

	const resolveMountedScrollWindowMeasurement = (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		measurementRowModel: TRowModel,
		nextLayout: ViewPlanLayoutMetrics,
	): MountedScrollWindowMeasurement => {
		return rangeResolver.resolveMountedScrollWindowMeasurement(
			scrollTop,
			viewportHeight,
			sectionTop,
			nextLayout,
			measurementRowModel,
		);
	};

	const resolveScrollWindowMeasurement = (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		measurementRowModel: TRowModel,
		nextLayout: ViewPlanLayoutMetrics,
		precomputedMountedRange: RowRange | undefined,
	): RangedScrollWindowMeasurement => {
		return rangeResolver.resolveScrollWindowMeasurement(
			scrollTop,
			viewportHeight,
			sectionTop,
			nextLayout,
			precomputedMountedRange,
			measurementRowModel,
		);
	};

	interface ViewPlanScrollMeasurementContext {
		rowModel: TRowModel;
		layout: ViewPlanLayoutMetrics;
	}

	const scrollMeasurementContext: ViewPlanScrollMeasurementContext = {
		rowModel: params.runtime.rowModel,
		layout: params.state.layout,
	};

	const scrollWindowMeasurementController =
		createVirtualScrollWindowMeasurementController<ViewPlanScrollMeasurementContext>(
			{
				applyUnstableScrollMeasurement: false,
				resolveMountedScrollWindowMeasurement(measurement, context) {
					return resolveMountedScrollWindowMeasurement(
						measurement.scrollTop,
						measurement.viewportHeight,
						measurement.sectionTop,
						context.rowModel,
						context.layout,
					);
				},
				resolveScrollWindowMeasurement(
					measurement,
					context,
					precomputedMountedRange,
				) {
					return resolveScrollWindowMeasurement(
						measurement.scrollTop,
						measurement.viewportHeight,
						measurement.sectionTop,
						context.rowModel,
						context.layout,
						precomputedMountedRange,
					);
				},
				applyRangeMeasurement(measurement, context, precomputedRanges) {
					return updateVisibleFlatRowRangeFromMeasurement(
						measurement.scrollTop,
						measurement.viewportHeight,
						measurement.sectionTop,
						measurement.isStableMeasurement,
						measurement.isScrollActive,
						context.rowModel,
						context.layout,
						precomputedRanges,
					);
				},
				syncPreviewRange(ranges) {
					params.runtime.syncPreviewVisibleRange(
						ranges.previewVisible.start,
						ranges.previewVisible.end,
					);
				},
				onStableMeasurement() {},
			},
		);

	const applyLayoutMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		const sectionEl = params.state.rootEl;
		if (!sectionEl || !nextMeasurement.sectionRect) {
			scrollWindowMeasurementController.resetLastScrollWindow();
			return "skipped";
		}
		const hasRenderableSections = params.getValidatedSections().length > 0;
		const layoutStability = resolveVirtualListLayoutStability({
			rootEl: sectionEl,
			rootRect: nextMeasurement.sectionRect,
			measuredWidth: params.state.measurement.measuredWidth,
			hasRenderableContent: hasRenderableSections,
		});
		if (!nextMeasurement.isStableMeasurement || !layoutStability.isStable) {
			scrollWindowMeasurementController.resetLastScrollWindow();
			return "unstable";
		}

		const layoutBase = resolveCachedCardGridLayoutBase({
			rootEl: sectionEl,
			rootRect: nextMeasurement.sectionRect,
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
		if (!isSameViewPlanLayout(params.state.layout, nextLayout)) {
			params.state.setLayout(nextLayout);
		}

		const result = updateVisibleFlatRowRangeFromMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			nextMeasurement.isStableMeasurement,
			false,
			nextRowModel,
			nextLayout,
		);
		if (result.kind !== "stable") {
			scrollWindowMeasurementController.resetLastScrollWindow();
			return "unstable";
		}

		scrollMeasurementContext.rowModel = nextRowModel;
		scrollMeasurementContext.layout = nextLayout;
		scrollWindowMeasurementController.primeLastScrollWindow(
			nextMeasurement,
			scrollMeasurementContext,
		);
		measurementController.scheduleScrollMeasurement();
		return "stable";
	};

	const applyScrollMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		const nextLayout = params.state.layout;
		const nextRowModel = cachedRowModelOverride ?? params.runtime.rowModel;
		scrollMeasurementContext.rowModel = nextRowModel;
		scrollMeasurementContext.layout = nextLayout;
		return scrollWindowMeasurementController.applyScrollMeasurement(
			nextMeasurement,
			scrollMeasurementContext,
		);
	};

	const applyMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult =>
		nextMeasurement.source === "layout"
			? applyLayoutMeasurement(nextMeasurement)
			: applyScrollMeasurement(nextMeasurement);

	const measurementController = createVirtualMeasurementController({
		getRootEl: () => params.state.rootEl,
		measurement: params.state.measurement,
		hasRenderableContent: () => params.runtime.rowModel.rowCount > 0,
		onMeasurement: applyMeasurement,
		enableBootstrapMeasurementSuppression: true,
		enableInitialStabilization: true,
		primeUnstableScrollStart: true,
		maxUnstableMeasurementRetries:
			CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES,
		frameCoordinator: params.frameCoordinator,
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

		measurementController.scheduleLayoutMeasurement();
	};

	const updateCachedMeasurementForDataChange = (): void => {
		const nextLayout = untrack(() => params.state.layout);
		if (measurementController.hasPendingLayoutMeasurement()) {
			return;
		}

		const nextRowModel = params.runtime.resolveRowModel(nextLayout);
		cachedRowModelOverride = nextRowModel;
		try {
			measurementController.runScrollMeasurement(undefined, {
				forcePublish: true,
			});
		} finally {
			cachedRowModelOverride = null;
		}
	};

	const observeRootElement = (): (() => void) | undefined => {
		if (!params.state.rootEl || typeof window === "undefined") {
			return;
		}

		hasObservedInitialLayout = false;
		hasConsumedInitialCardLayoutEffect = false;
		initialObservedCardLayout = untrack(params.getConfiguredCardLayout);

		const stopObserving = measurementController.observeRoot(
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
		snapshot: Parameters<typeof flushCachedVirtualScrollMeasurement>[0]["snapshot"],
	): void => {
		flushCachedVirtualScrollMeasurement({
			measurement: params.state.measurement,
			snapshot,
			updateFromCachedMeasurement: (metrics) =>
				measurementController.runScrollMeasurement(metrics),
		});
	};

	return {
		scheduleLayoutMeasurementForCardLayout,
		updateCachedMeasurementForDataChange,
		observeRootElement,
		flushVirtualScrollMeasurement,
	};
}
