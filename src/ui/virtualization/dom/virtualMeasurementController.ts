import { markVirtualScrollMeasurementRun } from "ui/virtualization/scheduling/virtualScrollMeasurementFrame";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type {
	ScrollMeasurementRange,
	VirtualListSharedScrollMetrics,
} from "./virtualListDomObserver";
import {
	observeVirtualListViewport,
	type VirtualListViewportObservation,
} from "./virtualListDomObserver";
import {
	readVirtualListCachedMeasurementInto,
	type VirtualListCachedMeasurementInput,
} from "./virtualListCachedMeasurement";
import { readVirtualListLiveMeasurement } from "./virtualListLiveMeasurement";
import { type VirtualListScrollSnapshot } from "./virtualListMeasurementAdapter";
import { createBootstrapMeasurementSuppression } from "./bootstrapMeasurementSuppression";
import { createInitialVirtualListStabilization } from "./initialVirtualListStabilization";
import type { VirtualListMeasurementStateHandle } from "./virtualListMeasurementState";
import { getOptionalOwnerWindow } from "ui/shared/dom/realmSafeDom";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

export type VirtualMeasurementSource = "layout" | "scroll";

export interface VirtualMeasurement {
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly sectionTop: number;
	readonly isStableMeasurement: boolean;
	readonly isScrollActive: boolean;
	/** Observer scroll generation represented by this measurement. */
	readonly scrollGeneration: number;
	readonly source: VirtualMeasurementSource;
	readonly sectionRect?: DOMRect;
	readonly sharedScrollMetrics?: VirtualListSharedScrollMetrics;
}

export type VirtualMeasurementResult =
	| { readonly kind: "measured"; readonly measurement: VirtualMeasurement }
	| {
			readonly kind: "skipped";
			readonly reason: "no-root" | "no-window" | "unchanged-scroll";
	  };

export type VirtualMeasurementApplicationResult = "stable" | "unstable" | "skipped";

export interface VirtualListStableMeasurementContext {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isScrollActive: boolean;
	sharedScrollMetrics?: VirtualListSharedScrollMetrics;
}

export type VirtualScrollMeasurementReason =
	| "scroll-coverage-miss"
	| "scroll-idle"
	| "data-change"
	| "post-layout";

export interface RunVirtualScrollMeasurementOptions {
	/**
	 * Publish even when the cached scroll geometry matches the last stable
	 * measurement. Use this when non-scroll inputs, such as row data, changed.
	 */
	forcePublish?: boolean;
	/** Dev-only reason for measurement classification. */
	reason?: VirtualScrollMeasurementReason;
}

type MutableVirtualMeasurement = {
	-readonly [K in keyof VirtualMeasurement]: VirtualMeasurement[K];
};

export interface CreateVirtualMeasurementControllerOptions {
	getRootEl: () => HTMLElement | null;
	measurement: VirtualListMeasurementStateHandle;
	hasRenderableContent?: () => boolean;
	onMeasurement?: (
		measurement: VirtualMeasurement,
	) => VirtualMeasurementApplicationResult | void;
	onObservedWidthChange?: (width: number) => void;
	onScrollContainerChange?: (element: HTMLElement | null) => void;
	/** Returns the range to push after each applied measurement. */
	getScrollMeasurementRange?: () => ScrollMeasurementRange | null;
	initialStabilizationMaxPasses?: number;
	maxUnstableMeasurementRetries: number;
	frameCoordinator: VirtualFrameCoordinator;
}

const SKIPPED_NO_ROOT: VirtualMeasurementResult = {
	kind: "skipped",
	reason: "no-root",
};

const SKIPPED_NO_WINDOW: VirtualMeasurementResult = {
	kind: "skipped",
	reason: "no-window",
};

const SKIPPED_UNCHANGED_SCROLL: VirtualMeasurementResult = {
	kind: "skipped",
	reason: "unchanged-scroll",
};

const EMPTY_RUN_SCROLL_MEASUREMENT_OPTIONS: RunVirtualScrollMeasurementOptions = {};
const MEASUREMENT_LANE = "scroll-critical" as const;
const LAYOUT_MEASUREMENT_TASK_KEY = "virtual-list:layout-measurement";
const SCROLL_MEASUREMENT_TASK_KEY = "virtual-list:scroll-measurement";
const UNSTABLE_MEASUREMENT_TASK_KEY = "virtual-list:unstable-measurement";

export function createVirtualMeasurementController({
	getRootEl,
	measurement,
	hasRenderableContent = () => true,
	onMeasurement,
	onObservedWidthChange,
	onScrollContainerChange,
	getScrollMeasurementRange,
	initialStabilizationMaxPasses,
	maxUnstableMeasurementRetries,
	frameCoordinator,
}: CreateVirtualMeasurementControllerOptions) {
	const cachedScrollSnapshot: VirtualListScrollSnapshot = {
		scrollTop: 0,
		viewportHeight: 0,
	};
	const scrollMeasurement: MutableVirtualMeasurement = {
		scrollTop: 0,
		viewportHeight: 0,
		sectionTop: 0,
		isStableMeasurement: false,
		isScrollActive: false,
		scrollGeneration: 0,
		source: "scroll",
		sharedScrollMetrics: undefined,
	};
	const scrollMeasurementResult: VirtualMeasurementResult = {
		kind: "measured",
		measurement: scrollMeasurement,
	};
	const cachedMeasurementInput: VirtualListCachedMeasurementInput = {
		rootEl: null,
		scrollContainerEl: null,
		viewportHeight: 0,
		sectionTop: 0,
		hasStableScrollMetrics: false,
		hasRenderableContent: false,
		cachedScrollSnapshot,
	};
	let hasLastPublishedScrollMeasurement = false;
	let lastPublishedScrollTop = 0;
	let lastPublishedViewportHeight = 0;
	let lastPublishedSectionTop = 0;
	let lastPublishedIsStableMeasurement = false;
	let lastPublishedIsScrollActive = false;
	let observedScrollGeneration = 0;
	let hasPendingObservedScrollTop = false;
	let isObservedScrollActive = false;
	let pendingScrollMeasurementReason: VirtualScrollMeasurementReason | null = null;
	let activeViewportObservation: VirtualListViewportObservation | null = null;
	let unstableMeasurementRetryCount = 0;
	let pendingScrollMeasurementTask: (() => void) | undefined;

	const rememberPublishedScrollMeasurement = (
		measurement: VirtualMeasurement,
	): void => {
		hasLastPublishedScrollMeasurement = true;
		lastPublishedScrollTop = measurement.scrollTop;
		lastPublishedViewportHeight = measurement.viewportHeight;
		lastPublishedSectionTop = measurement.sectionTop;
		lastPublishedIsStableMeasurement = measurement.isStableMeasurement;
		lastPublishedIsScrollActive = measurement.isScrollActive;
	};

	const isUnchangedPublishedScrollMeasurement = (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		isStableMeasurement: boolean,
		isScrollActive: boolean,
	): boolean =>
		hasLastPublishedScrollMeasurement &&
		isStableMeasurement &&
		lastPublishedIsStableMeasurement &&
		lastPublishedScrollTop === scrollTop &&
		lastPublishedViewportHeight === viewportHeight &&
		lastPublishedSectionTop === sectionTop &&
		lastPublishedIsStableMeasurement === isStableMeasurement &&
		lastPublishedIsScrollActive === isScrollActive;

	const publishMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult => {
		const result = onMeasurement?.(nextMeasurement) ?? "stable";
		activeViewportObservation?.publishScrollMeasurementRange(
			getScrollMeasurementRange?.() ?? null,
		);
		return result;
	};

	const runLayoutMeasurement = (): VirtualMeasurementResult => {
		const rootEl = getRootEl();
		if (!rootEl) {
			return SKIPPED_NO_ROOT;
		}
		if (!getOptionalOwnerWindow(rootEl)) {
			return SKIPPED_NO_WINDOW;
		}

		const liveMeasurement = readVirtualListLiveMeasurement({
			rootEl,
			scrollContainerEl: measurement.scrollContainerEl,
			hasRenderableContent: hasRenderableContent(),
		});

		measurement.updateFromLiveMetrics(
			{
				sectionTop: liveMeasurement.sectionTop,
				viewportHeight: liveMeasurement.viewportHeight,
			},
			liveMeasurement.isStableMeasurement,
		);
		hasLastPublishedScrollMeasurement = false;

		const nextMeasurement: VirtualMeasurement = {
			scrollTop: liveMeasurement.scrollTop,
			viewportHeight: liveMeasurement.viewportHeight,
			sectionTop: liveMeasurement.sectionTop,
			isStableMeasurement: liveMeasurement.isStableMeasurement,
			isScrollActive: false,
			scrollGeneration: observedScrollGeneration,
			source: "layout",
			sectionRect: liveMeasurement.sectionRect,
		};
		const applicationResult = publishMeasurement(nextMeasurement);

		if (liveMeasurement.isStableMeasurement && applicationResult === "stable") {
			resetUnstableMeasurementRetry();
		} else {
			scheduleUnstableMeasurementRetry();
		}

		return { kind: "measured", measurement: nextMeasurement };
	};

	const runScrollMeasurement = (
		sharedScrollMetrics?: VirtualListSharedScrollMetrics,
		optionsOrReason:
			| RunVirtualScrollMeasurementOptions
			| VirtualScrollMeasurementReason = EMPTY_RUN_SCROLL_MEASUREMENT_OPTIONS,
	): VirtualMeasurementResult => {
		const isReasonOnly = typeof optionsOrReason === "string";
		const forcePublish = isReasonOnly ? false : optionsOrReason.forcePublish;
		const resolvedReason =
			(isReasonOnly ? optionsOrReason : optionsOrReason.reason) ??
			pendingScrollMeasurementReason ??
			undefined;
		pendingScrollMeasurementReason = null;
		const rootEl = getRootEl();
		if (!getOptionalOwnerWindow(rootEl ?? measurement.scrollContainerEl)) {
			return SKIPPED_NO_WINDOW;
		}
		cachedMeasurementInput.rootEl = rootEl;
		cachedMeasurementInput.scrollContainerEl = measurement.scrollContainerEl;
		cachedMeasurementInput.viewportHeight = measurement.viewportHeight;
		cachedMeasurementInput.sectionTop = measurement.sectionTop;
		cachedMeasurementInput.hasStableScrollMetrics =
			measurement.hasStableScrollMetrics;
		cachedMeasurementInput.hasRenderableContent = hasRenderableContent();
		cachedMeasurementInput.sharedScrollMetrics = sharedScrollMetrics;

		readVirtualListCachedMeasurementInto(scrollMeasurement, cachedMeasurementInput);
		scrollMeasurement.scrollGeneration =
			sharedScrollMetrics?.scrollGeneration ?? observedScrollGeneration;
		if (
			!forcePublish &&
			isUnchangedPublishedScrollMeasurement(
				scrollMeasurement.scrollTop,
				scrollMeasurement.viewportHeight,
				scrollMeasurement.sectionTop,
				scrollMeasurement.isStableMeasurement,
				scrollMeasurement.isScrollActive,
			)
		) {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement(
					"virtualScroll.applyScrollMeasurement.skippedUnchanged",
				);
			}
			return SKIPPED_UNCHANGED_SCROLL;
		}

		// Recorded only for measurements that pass the unchanged gate, so reason
		// counters reflect actually published measurements.
		if (process.env.NODE_ENV !== "production" && resolvedReason) {
			recordCCLDevMeasurement(
				resolvedReason === "scroll-coverage-miss"
					? "virtualScroll.applyScrollMeasurement.scrollCoverageMiss"
					: resolvedReason === "scroll-idle"
						? "virtualScroll.applyScrollMeasurement.scrollIdle"
						: resolvedReason === "data-change"
							? "virtualScroll.applyScrollMeasurement.dataChange"
							: "virtualScroll.applyScrollMeasurement.postLayout",
			);
		}

		markVirtualScrollMeasurementRun();
		const applicationResult = publishMeasurement(scrollMeasurement);
		rememberPublishedScrollMeasurement(scrollMeasurement);

		if (scrollMeasurement.isStableMeasurement && applicationResult === "stable") {
			resetUnstableMeasurementRetry();
		} else {
			scheduleUnstableMeasurementRetry();
		}

		return scrollMeasurementResult;
	};

	const hasSchedulingWindow = (): boolean =>
		getOptionalOwnerWindow(getRootEl()) !== null;

	const hasPendingLayoutMeasurement = (): boolean =>
		frameCoordinator.isScheduled(MEASUREMENT_LANE, LAYOUT_MEASUREMENT_TASK_KEY) ||
		frameCoordinator.isScheduled(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);

	function scheduleLayoutMeasurement(): void {
		if (
			!hasSchedulingWindow() ||
			frameCoordinator.isScheduled(MEASUREMENT_LANE, LAYOUT_MEASUREMENT_TASK_KEY)
		) {
			return;
		}

		frameCoordinator.cancel(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);
		frameCoordinator.cancel(MEASUREMENT_LANE, SCROLL_MEASUREMENT_TASK_KEY);
		frameCoordinator.schedule(
			MEASUREMENT_LANE,
			LAYOUT_MEASUREMENT_TASK_KEY,
			runLayoutMeasurement,
		);
	}

	const runScheduledScrollMeasurement = (): void => {
		const task = pendingScrollMeasurementTask ?? runScrollMeasurement;
		pendingScrollMeasurementTask = undefined;
		task();
	};

	function scheduleScrollMeasurement(task?: () => void): void {
		if (task) {
			pendingScrollMeasurementTask = task;
		}
		if (
			!hasSchedulingWindow() ||
			hasPendingLayoutMeasurement() ||
			frameCoordinator.isScheduled(MEASUREMENT_LANE, SCROLL_MEASUREMENT_TASK_KEY)
		) {
			return;
		}

		frameCoordinator.schedule(
			MEASUREMENT_LANE,
			SCROLL_MEASUREMENT_TASK_KEY,
			runScheduledScrollMeasurement,
		);
	}

	const runUnstableMeasurementRetry = (): void => {
		unstableMeasurementRetryCount += 1;
		runLayoutMeasurement();
	};

	function scheduleUnstableMeasurementRetry(): void {
		if (
			!hasSchedulingWindow() ||
			frameCoordinator.isScheduled(
				MEASUREMENT_LANE,
				UNSTABLE_MEASUREMENT_TASK_KEY,
			) ||
			unstableMeasurementRetryCount >= maxUnstableMeasurementRetries
		) {
			return;
		}

		frameCoordinator.schedule(
			MEASUREMENT_LANE,
			UNSTABLE_MEASUREMENT_TASK_KEY,
			runUnstableMeasurementRetry,
		);
	}

	function resetUnstableMeasurementRetry(): void {
		frameCoordinator.cancel(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);
		unstableMeasurementRetryCount = 0;
	}

	function cancelAllScheduledMeasurements(): void {
		frameCoordinator.cancel(MEASUREMENT_LANE, LAYOUT_MEASUREMENT_TASK_KEY);
		frameCoordinator.cancel(MEASUREMENT_LANE, SCROLL_MEASUREMENT_TASK_KEY);
		frameCoordinator.cancel(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);
		pendingScrollMeasurementTask = undefined;
	}
	const bootstrapMeasurementSuppression = createBootstrapMeasurementSuppression(
		scheduleLayoutMeasurement,
		() => getOptionalOwnerWindow(getRootEl()),
	);
	const initialStabilization = createInitialVirtualListStabilization({
		measurement,
		runLayoutMeasurement,
		getRootEl,
		getWindow: () => getOptionalOwnerWindow(getRootEl()),
		frameCoordinator,
		maxPasses: initialStabilizationMaxPasses,
	});

	const scheduleObservedLayoutMeasurement =
		bootstrapMeasurementSuppression.scheduleObservedLayoutMeasurement;

	const observeRoot = (
		rootEl: HTMLElement,
		runWithoutTracking: (callback: () => void) => void = (callback) => callback(),
	): (() => void) => {
		const observation = observeVirtualListViewport({
			rootEl,
			frameCoordinator,
			onWidthChange: (width) => {
				measurement.measuredWidth = width;
				onObservedWidthChange?.(width);
			},
			getCachedViewportHeight: () => measurement.viewportHeight,
			getScrollMeasurementRange,
			onScrollStateChange: (generation, hasPendingScrollTop, isScrollActive) => {
				observedScrollGeneration = generation;
				hasPendingObservedScrollTop = hasPendingScrollTop;
				isObservedScrollActive = isScrollActive;
			},
			onScrollContainerChange: (element) => {
				measurement.scrollContainerEl = element;
				measurement.invalidateViewport();
				onScrollContainerChange?.(element);
			},
			scheduleLayoutMeasurement: scheduleObservedLayoutMeasurement,
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: () => {
				runWithoutTracking(() => {
					bootstrapMeasurementSuppression.suppressForBootstrap();
					runLayoutMeasurement();
					initialStabilization.schedule();
				});
			},
			cancelInitialStabilizationMeasurement:
				initialStabilization.cancelBecauseScrollStarted,
			onScrollStart: () => {
				if (measurement.hasStableScrollMetrics) return;
				if (hasPendingLayoutMeasurement()) return;
				scheduleLayoutMeasurement();
			},
		});
		activeViewportObservation = observation;

		return () => {
			if (activeViewportObservation === observation) {
				activeViewportObservation = null;
			}
			bootstrapMeasurementSuppression.cancel();
			initialStabilization.cancel();
			cancelAllScheduledMeasurements();
			observation();
		};
	};

	return {
		hasPendingLayoutMeasurement,
		observeRoot,
		runLayoutMeasurement,
		runScrollMeasurement,
		scheduleLayoutMeasurement,
		scheduleScrollMeasurement,
		/**
		 * Schedules the post-layout scroll pass only when observer-owned scroll
		 * state was not fully represented by the layout measurement.
		 */
		scheduleScrollMeasurementAfterLayout(
			layoutMeasurement: VirtualMeasurement,
		): void {
			if (layoutMeasurement.source !== "layout") {
				return;
			}
			if (
				observedScrollGeneration <= layoutMeasurement.scrollGeneration &&
				!hasPendingObservedScrollTop &&
				!isObservedScrollActive
			) {
				return;
			}

			pendingScrollMeasurementReason = "post-layout";
			scheduleScrollMeasurement();
		},
	};
}
