import type { VirtualListSharedScrollMetrics } from "./virtualListDomObserver";
import { observeVirtualListViewport } from "./virtualListDomObserver";
import { readVirtualListCachedMeasurement } from "./virtualListCachedMeasurement";
import { readVirtualListLiveMeasurement } from "./virtualListLiveMeasurement";
import { type VirtualListScrollSnapshot } from "./virtualListMeasurementAdapter";
import { createBootstrapMeasurementSuppression } from "./bootstrapMeasurementSuppression";
import { createInitialVirtualListStabilization } from "./initialVirtualListStabilization";
import { createVirtualListMeasurementScheduler } from "./virtualListMeasurementScheduler";
import type { VirtualListMeasurementStateHandle } from "./virtualListMeasurementState";
import { getOptionalOwnerWindow } from "ui/utils/realmSafeDom";

export type VirtualMeasurementSource = "layout" | "scroll";

export interface VirtualMeasurement {
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly sectionTop: number;
	readonly isStableMeasurement: boolean;
	readonly isScrollActive: boolean;
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
	enableBootstrapMeasurementSuppression?: boolean;
	enableInitialStabilization?: boolean;
	initialStabilizationMaxPasses?: number;
	primeUnstableScrollStart?: boolean;
	maxUnstableMeasurementRetries: number;
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

export function createVirtualMeasurementController({
	getRootEl,
	measurement,
	hasRenderableContent = () => true,
	onMeasurement,
	onObservedWidthChange,
	onScrollContainerChange,
	enableBootstrapMeasurementSuppression = false,
	enableInitialStabilization = false,
	initialStabilizationMaxPasses,
	primeUnstableScrollStart = false,
	maxUnstableMeasurementRetries,
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
		source: "scroll",
		sharedScrollMetrics: undefined,
	};
	let hasLastPublishedScrollMeasurement = false;
	let lastPublishedScrollTop = 0;
	let lastPublishedViewportHeight = 0;
	let lastPublishedSectionTop = 0;
	let lastPublishedIsStableMeasurement = false;
	let lastPublishedIsScrollActive = false;

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

	const isUnchangedPublishedScrollMeasurement = (params: {
		scrollTop: number;
		viewportHeight: number;
		sectionTop: number;
		isStableMeasurement: boolean;
		isScrollActive: boolean;
	}): boolean =>
		hasLastPublishedScrollMeasurement &&
		params.isStableMeasurement &&
		lastPublishedIsStableMeasurement &&
		lastPublishedScrollTop === params.scrollTop &&
		lastPublishedViewportHeight === params.viewportHeight &&
		lastPublishedSectionTop === params.sectionTop &&
		lastPublishedIsStableMeasurement === params.isStableMeasurement &&
		lastPublishedIsScrollActive === params.isScrollActive;

	const publishMeasurement = (
		nextMeasurement: VirtualMeasurement,
	): {
		readonly result: VirtualMeasurementResult;
		readonly applicationResult: VirtualMeasurementApplicationResult;
	} => {
		const applicationResult = onMeasurement?.(nextMeasurement) ?? "stable";
		return {
			result: { kind: "measured", measurement: nextMeasurement },
			applicationResult,
		};
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

		const { result, applicationResult } = publishMeasurement({
			scrollTop: liveMeasurement.scrollTop,
			viewportHeight: liveMeasurement.viewportHeight,
			sectionTop: liveMeasurement.sectionTop,
			isStableMeasurement: liveMeasurement.isStableMeasurement,
			isScrollActive: false,
			source: "layout",
			sectionRect: liveMeasurement.sectionRect,
		});

		if (liveMeasurement.isStableMeasurement && applicationResult === "stable") {
			resetUnstableMeasurementRetry();
		} else {
			scheduleUnstableMeasurementRetry();
		}

		return result;
	};

	const runScrollMeasurement = (
		sharedScrollMetrics?: VirtualListSharedScrollMetrics,
	): VirtualMeasurementResult => {
		if (!getOptionalOwnerWindow(getRootEl() ?? measurement.scrollContainerEl)) {
			return SKIPPED_NO_WINDOW;
		}

		const cachedMeasurement = readVirtualListCachedMeasurement({
			rootEl: getRootEl(),
			scrollContainerEl: measurement.scrollContainerEl,
			viewportHeight: measurement.viewportHeight,
			sectionTop: measurement.sectionTop,
			hasStableScrollMetrics: measurement.hasStableScrollMetrics,
			hasRenderableContent: hasRenderableContent(),
			cachedScrollSnapshot,
			sharedScrollMetrics,
		});
		if (
			isUnchangedPublishedScrollMeasurement({
				scrollTop: cachedMeasurement.scrollTop,
				viewportHeight: cachedMeasurement.viewportHeight,
				sectionTop: cachedMeasurement.sectionTop,
				isStableMeasurement: cachedMeasurement.isStableMeasurement,
				isScrollActive: cachedMeasurement.isScrollActive,
			})
		) {
			return SKIPPED_UNCHANGED_SCROLL;
		}

		scrollMeasurement.scrollTop = cachedMeasurement.scrollTop;
		scrollMeasurement.viewportHeight = cachedMeasurement.viewportHeight;
		scrollMeasurement.sectionTop = cachedMeasurement.sectionTop;
		scrollMeasurement.isStableMeasurement = cachedMeasurement.isStableMeasurement;
		scrollMeasurement.isScrollActive = cachedMeasurement.isScrollActive;
		scrollMeasurement.sharedScrollMetrics = cachedMeasurement.sharedScrollMetrics;
		const { result, applicationResult } = publishMeasurement(scrollMeasurement);
		if (result.kind === "measured") {
			rememberPublishedScrollMeasurement(result.measurement);
		}

		if (cachedMeasurement.isStableMeasurement && applicationResult === "stable") {
			resetUnstableMeasurementRetry();
		} else {
			scheduleUnstableMeasurementRetry();
		}

		return result;
	};

	const {
		cancelAll,
		hasPendingLayoutMeasurement,
		resetUnstableMeasurementRetry,
		scheduleLayoutMeasurement,
		scheduleScrollMeasurement,
		scheduleUnstableMeasurementRetry,
	} = createVirtualListMeasurementScheduler({
		runLayoutMeasurement,
		runScrollMeasurement,
		maxUnstableMeasurementRetries,
		getWindow: () => getOptionalOwnerWindow(getRootEl()),
	});
	const bootstrapMeasurementSuppression = createBootstrapMeasurementSuppression(
		scheduleLayoutMeasurement,
		() => getOptionalOwnerWindow(getRootEl()),
	);
	const initialStabilization = createInitialVirtualListStabilization({
		measurement,
		runLayoutMeasurement,
		getRootEl,
		getWindow: () => getOptionalOwnerWindow(getRootEl()),
		maxPasses: initialStabilizationMaxPasses,
	});

	const scheduleObservedLayoutMeasurement = enableBootstrapMeasurementSuppression
		? bootstrapMeasurementSuppression.scheduleObservedLayoutMeasurement
		: scheduleLayoutMeasurement;

	const observeRoot = (
		rootEl: HTMLElement,
		runWithoutTracking: (callback: () => void) => void = (callback) => callback(),
	): (() => void) => {
		const stopObserving = observeVirtualListViewport({
			rootEl,
			onWidthChange: (width) => {
				measurement.measuredWidth = width;
				onObservedWidthChange?.(width);
			},
			getCachedViewportHeight: () => measurement.viewportHeight,
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
					if (enableBootstrapMeasurementSuppression) {
						bootstrapMeasurementSuppression.suppressForBootstrap();
					}
					runLayoutMeasurement();
					if (enableInitialStabilization) {
						initialStabilization.schedule();
					}
				});
			},
			cancelInitialStabilizationMeasurement: enableInitialStabilization
				? initialStabilization.cancelBecauseScrollStarted
				: undefined,
			onScrollStart: primeUnstableScrollStart
				? () => {
						if (measurement.hasStableScrollMetrics) return;
						if (hasPendingLayoutMeasurement()) return;
						runLayoutMeasurement();
					}
				: undefined,
		});

		return () => {
			bootstrapMeasurementSuppression.cancel();
			initialStabilization.cancel();
			cancelAll();
			stopObserving();
		};
	};

	return {
		hasPendingLayoutMeasurement,
		observeRoot,
		runLayoutMeasurement,
		runScrollMeasurement,
		scheduleLayoutMeasurement,
		scheduleScrollMeasurement,
	};
}
