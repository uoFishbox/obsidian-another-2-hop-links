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
import type { MeasurementUpdateResult } from "../dom/virtualListMeasurementAdapter";
import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";
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

	let lastScrollWindow: LastScrollWindow | null = null;
	let cachedRowModelOverride: TRowModel | null = null;

	const toApplicationResult = (
		result: MeasurementUpdateResult<RowRange>,
	): VirtualMeasurementApplicationResult =>
		result.kind === "stable" ? "stable" : "unstable";

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

	const primeLastScrollWindow = (
		measurement: VirtualMeasurement,
		nextRowModel: TRowModel,
		nextLayout: ViewPlanLayoutMetrics,
	): void => {
		if (!measurement.isStableMeasurement) {
			lastScrollWindow = null;
			return;
		}

		const mountedScrollWindow = resolveMountedScrollWindowMeasurement(
			measurement.scrollTop,
			measurement.viewportHeight,
			measurement.sectionTop,
			nextRowModel,
			nextLayout,
		);
		lastScrollWindow = createMountedScrollWindow(
			mountedScrollWindow.identity,
			mountedScrollWindow.mounted,
			mountedScrollWindow.stableMountedScrollTopBand,
		);
	};

	const applyLayoutMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		const sectionEl = params.state.rootEl;
		if (!sectionEl || !nextMeasurement.sectionRect) {
			lastScrollWindow = null;
			return "skipped";
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
		const hasRenderableSections = params.getValidatedSections().length > 0;
		const layoutStability = resolveVirtualListLayoutStability({
			rootEl: sectionEl,
			rootRect: nextMeasurement.sectionRect,
			measuredWidth: params.state.measurement.measuredWidth,
			hasRenderableContent: hasRenderableSections,
		});
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
		if (result.kind !== "stable" || !layoutStability.isStable) {
			lastScrollWindow = null;
			return "unstable";
		}

		primeLastScrollWindow(nextMeasurement, nextRowModel, nextLayout);
		measurementController.scheduleScrollMeasurement();
		return "stable";
	};

	const returnStableScrollMeasurement = (): VirtualMeasurementApplicationResult =>
		"stable";

	const applyScrollMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		if (!nextMeasurement.isStableMeasurement) {
			lastScrollWindow = null;
			return "unstable";
		}

		const nextLayout = params.state.layout;
		const nextRowModel = cachedRowModelOverride ?? params.runtime.rowModel;
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

		if (nextMeasurement.isScrollActive) {
			const mountedScrollWindow = resolveMountedScrollWindowMeasurement(
				nextMeasurement.scrollTop,
				nextMeasurement.viewportHeight,
				nextMeasurement.sectionTop,
				nextRowModel,
				nextLayout,
			);
			precomputedMountedRange = mountedScrollWindow.mounted;
			if (
				isSameMountedScrollWindow(
					lastScrollWindow,
					mountedScrollWindow.identity,
					mountedScrollWindow.mounted,
				) &&
				(isWithinStableMountedScrollWindow(
					lastScrollWindow,
					mountedScrollWindow.identity,
					mountedScrollWindow.mounted,
					nextMeasurement.scrollTop,
				) ||
					isWithinStablePreviewScrollWindow(
						lastScrollWindow,
						mountedScrollWindow.identity,
						mountedScrollWindow.mounted,
						nextMeasurement.scrollTop,
					))
			) {
				return returnStableScrollMeasurement();
			}
			pendingMountedScrollWindowMeasurement = mountedScrollWindow;

			const scrollWindow = resolveScrollWindowMeasurement(
				nextMeasurement.scrollTop,
				nextMeasurement.viewportHeight,
				nextMeasurement.sectionTop,
				nextRowModel,
				nextLayout,
				precomputedMountedRange,
			);
			precomputedRanges = scrollWindow.ranges;
			if (
				isSameRangedScrollWindow(
					lastScrollWindow,
					scrollWindow.identity,
					scrollWindow.ranges,
					"visible-and-mounted",
				)
			) {
				return returnStableScrollMeasurement();
			}
			if (
				isSameMountedScrollWindow(
					lastScrollWindow,
					scrollWindow.identity,
					scrollWindow.ranges.mounted,
				)
			) {
				params.runtime.syncPreviewVisibleRange(
					scrollWindow.ranges.previewVisible.start,
					scrollWindow.ranges.previewVisible.end,
				);
				lastScrollWindow = updateMountedAndPreviewScrollWindow(
					lastScrollWindow,
					scrollWindow.identity,
					scrollWindow.ranges,
					scrollWindow.stablePreviewScrollTopBand,
					pendingMountedScrollWindowMeasurement.stableMountedScrollTopBand,
				);
				return returnStableScrollMeasurement();
			}

			nextScrollWindowIdentity = scrollWindow.identity;
			nextScrollWindowRanges = scrollWindow.ranges;
			nextStablePreviewScrollTopBand = scrollWindow.stablePreviewScrollTopBand;
			if (
				pendingMountedScrollWindowMeasurement.identity ===
					scrollWindow.identity &&
				pendingMountedScrollWindowMeasurement.mounted.start ===
					scrollWindow.ranges.mounted.start &&
				pendingMountedScrollWindowMeasurement.mounted.end ===
					scrollWindow.ranges.mounted.end
			) {
				nextStableMountedScrollTopBand =
					pendingMountedScrollWindowMeasurement.stableMountedScrollTopBand;
			}
		} else {
			lastScrollWindow = null;
		}

		const result = updateVisibleFlatRowRangeFromMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			nextMeasurement.isStableMeasurement,
			nextMeasurement.isScrollActive,
			nextRowModel,
			nextLayout,
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
			primeLastScrollWindow(nextMeasurement, nextRowModel, nextLayout);
		}
		return "stable";
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
			measurementController.runScrollMeasurement();
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
		scrollContainerEl: HTMLElement | null,
		targetTop: number,
	): void => {
		flushCachedVirtualScrollMeasurement({
			measurement: params.state.measurement,
			scrollContainerEl,
			targetTop,
			updateFromCachedMeasurement: () =>
				measurementController.runScrollMeasurement(),
		});
	};

	return {
		scheduleLayoutMeasurementForCardLayout,
		updateCachedMeasurementForDataChange,
		observeRootElement,
		flushVirtualScrollMeasurement,
	};
}
