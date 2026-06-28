import { EMPTY_ROW_RANGE, type RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";
import {
	createMountedScrollWindow,
	isWithinStableMountedScrollWindow,
	isWithinStablePreviewScrollWindow,
	isSameMountedScrollWindow,
	isSameRangedScrollWindow,
	type ActiveScrollWindowComparison,
	type LastScrollWindow,
	type MountedScrollWindowMeasurement,
	type RangedScrollWindowMeasurement,
	type ScrollWindowIdentity,
	updateMountedAndPreviewScrollWindow,
	updateMountedScrollWindow,
} from "./activeScrollWindowGate";
export type {
	ActiveScrollWindowComparison,
	LastScrollWindow,
	ScrollWindowIdentity,
} from "./activeScrollWindowGate";
import {
	isStableCachedVirtualListMeasurementFromMetrics,
	isStableVirtualListMeasurement,
} from "./virtualListMeasurementStability";
import { observeVirtualListViewport } from "./virtualListDomObserver";
import type { VirtualListSharedScrollMetrics } from "./virtualListDomObserver";
import {
	getScrollMetrics,
	readScrollSnapshot,
	type MeasurementUpdateResult,
	type VirtualListScrollSnapshot,
} from "./virtualListMeasurementAdapter";
import type { VirtualListMeasurementStateHandle } from "./virtualListMeasurementState";
import {
	createPostPaintVirtualListTask,
	createVirtualListMeasurementScheduler,
} from "./virtualListScheduler";
import { getOptionalOwnerWindow } from "ui/utils/realmSafeDom";

const createBootstrapMeasurementSuppression = (
	scheduleLayoutMeasurement: () => void,
	getWindow: () => Window | null = () =>
		typeof window === "undefined" ? null : window,
) => {
	let suppressObservedLayoutMeasurement = false;
	let observedLayoutSuppressionHandle: number | null = null;

	const release = () => {
		suppressObservedLayoutMeasurement = false;
		observedLayoutSuppressionHandle = null;
	};

	const cancel = () => {
		if (observedLayoutSuppressionHandle === null) {
			return;
		}

		const ownerWindow = getWindow();
		if (ownerWindow) {
			if (typeof ownerWindow.cancelAnimationFrame === "function") {
				ownerWindow.cancelAnimationFrame(observedLayoutSuppressionHandle);
			} else {
				ownerWindow.clearTimeout(observedLayoutSuppressionHandle);
			}
		}
		release();
	};

	return {
		cancel,
		suppressForBootstrap() {
			const ownerWindow = getWindow();
			if (!ownerWindow) {
				return;
			}

			cancel();
			suppressObservedLayoutMeasurement = true;
			if (typeof ownerWindow.requestAnimationFrame === "function") {
				observedLayoutSuppressionHandle = ownerWindow.requestAnimationFrame(
					() => {
						release();
					},
				);
				return;
			}

			observedLayoutSuppressionHandle = ownerWindow.setTimeout(() => {
				release();
			}, 0);
		},
		scheduleObservedLayoutMeasurement() {
			if (suppressObservedLayoutMeasurement) {
				return;
			}

			scheduleLayoutMeasurement();
		},
	};
};

export { createBootstrapMeasurementSuppression };

export interface VirtualListRangeMeasurementContext<TLayout, TContent> {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isStableMeasurement: boolean;
	isScrollActive: boolean;
	content: TContent;
	layout: TLayout;
	precomputedMountedRange: RowRange | undefined;
	precomputedRanges: VirtualRanges | undefined;
}

export interface VirtualListStableMeasurementContext {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isScrollActive: boolean;
	sharedScrollMetrics?: VirtualListSharedScrollMetrics;
}

export interface VirtualListLayoutMeasurement<TLayout, TContent> {
	layout: TLayout;
	content: TContent;
	hasRenderableContent: boolean;
	hasStableLayout: boolean;
}

export interface CreateVirtualListControllerOptions<TLayout, TContent, TCachedOptions> {
	getRootEl: () => HTMLElement | null;
	measurement: VirtualListMeasurementStateHandle;
	getLayout: () => TLayout;
	setLayout: (layout: TLayout) => void;
	isSameLayout: (current: TLayout, next: TLayout) => boolean;
	resolveLayoutMeasurement: (
		rootEl: HTMLElement,
		rootRect: DOMRect,
	) => VirtualListLayoutMeasurement<TLayout, TContent>;
	getCachedContent: () => TContent;
	hasRenderableContent: (content: TContent) => boolean;
	applyRangeMeasurement: (
		context: VirtualListRangeMeasurementContext<TLayout, TContent>,
	) => MeasurementUpdateResult<RowRange>;
	resolveMountedScrollWindowMeasurement?: (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		content: TContent,
		layout: TLayout,
	) => MountedScrollWindowMeasurement | null;
	resolveScrollWindowMeasurement?: (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		content: TContent,
		layout: TLayout,
		precomputedMountedRange: RowRange | undefined,
	) => RangedScrollWindowMeasurement | null;
	onActiveScrollPreviewRangeMeasurement?: (ranges: VirtualRanges) => void;
	shouldSkipUnstableCachedMeasurement?: (options: TCachedOptions) => boolean;
	activeScrollWindowComparison?: ActiveScrollWindowComparison;
	onObservedWidthChange?: (width: number) => void;
	onLayoutMeasurementApplied?: (
		measurement: VirtualListLayoutMeasurement<TLayout, TContent>,
	) => void;
	onStableLayoutMeasurement?: (context: VirtualListStableMeasurementContext) => void;
	onStableScrollMeasurement?: (context: VirtualListStableMeasurementContext) => void;
	maxUnstableMeasurementRetries: number;
}

const SKIPPED_NO_ROOT: MeasurementUpdateResult<RowRange> = {
	kind: "skipped",
	reason: "no-root",
};
const SKIPPED_NO_WINDOW: MeasurementUpdateResult<RowRange> = {
	kind: "skipped",
	reason: "no-window",
};
const SKIPPED_UNSTABLE: MeasurementUpdateResult<RowRange> = {
	kind: "skipped",
	reason: "unstable",
};

export function createVirtualListController<
	TLayout,
	TContent,
	TCachedOptions = undefined,
>({
	getRootEl,
	measurement,
	getLayout,
	setLayout,
	isSameLayout,
	resolveLayoutMeasurement,
	getCachedContent,
	hasRenderableContent,
	applyRangeMeasurement,
	resolveMountedScrollWindowMeasurement,
	resolveScrollWindowMeasurement,
	onActiveScrollPreviewRangeMeasurement,
	shouldSkipUnstableCachedMeasurement,
	activeScrollWindowComparison = "visible-and-mounted",
	onObservedWidthChange,
	onLayoutMeasurementApplied,
	onStableLayoutMeasurement,
	onStableScrollMeasurement,
	maxUnstableMeasurementRetries,
}: CreateVirtualListControllerOptions<TLayout, TContent, TCachedOptions>) {
	let lastLiveMeasurementContext: VirtualListStableMeasurementContext | null = null;
	let lastCachedMeasurementContext: VirtualListStableMeasurementContext | null = null;
	let lastScrollWindow: LastScrollWindow | null = null;
	let cachedRangeMeasurementContext: VirtualListRangeMeasurementContext<
		TLayout,
		TContent
	> | null = null;
	const cachedScrollSnapshot: VirtualListScrollSnapshot = {
		scrollTop: 0,
		viewportHeight: 0,
	};
	const stableResult: MeasurementUpdateResult<RowRange> = {
		kind: "stable",
		range: EMPTY_ROW_RANGE,
	};

	const returnStable = (range: RowRange): MeasurementUpdateResult<RowRange> => {
		stableResult.range = range;
		return stableResult;
	};

	const resolveMountedComparableScrollWindow = (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		content: TContent,
		layout: TLayout,
	): LastScrollWindow | null => {
		if (
			activeScrollWindowComparison !== "mounted-only" ||
			!resolveMountedScrollWindowMeasurement
		) {
			return null;
		}

		const mountedScrollWindowMeasurement = resolveMountedScrollWindowMeasurement(
			scrollTop,
			viewportHeight,
			sectionTop,
			content,
			layout,
		);
		if (!mountedScrollWindowMeasurement) {
			return null;
		}

		return createMountedScrollWindow(
			mountedScrollWindowMeasurement.identity,
			mountedScrollWindowMeasurement.mounted,
			mountedScrollWindowMeasurement.stableMountedScrollTopBand,
		);
	};

	const primeLastScrollWindow = (
		measurementContext: VirtualListRangeMeasurementContext<TLayout, TContent>,
	): void => {
		if (!measurementContext.isStableMeasurement) {
			lastScrollWindow = null;
			return;
		}

		lastScrollWindow = resolveMountedComparableScrollWindow(
			measurementContext.scrollTop,
			measurementContext.viewportHeight,
			measurementContext.sectionTop,
			measurementContext.content,
			measurementContext.layout,
		);
	};

	const updateFromLiveMeasurement = (
		content: TContent,
		layout: TLayout,
		sectionRect?: DOMRect,
	): MeasurementUpdateResult<RowRange> => {
		const rootEl = getRootEl();
		lastLiveMeasurementContext = null;
		lastScrollWindow = null;
		if (!rootEl) {
			return SKIPPED_NO_ROOT;
		}
		if (!getOptionalOwnerWindow(rootEl)) {
			return SKIPPED_NO_WINDOW;
		}

		const resolvedSectionRect = sectionRect ?? rootEl.getBoundingClientRect();
		const scrollMetrics = getScrollMetrics(
			rootEl,
			measurement.scrollContainerEl,
			resolvedSectionRect,
		);
		lastLiveMeasurementContext = {
			scrollTop: scrollMetrics.scrollTop,
			viewportHeight: scrollMetrics.viewportHeight,
			sectionTop: scrollMetrics.sectionTop,
			isScrollActive: false,
		};
		const isStableMeasurement = isStableVirtualListMeasurement({
			hasRenderableContent: hasRenderableContent(content),
			rootRect: resolvedSectionRect,
			viewportHeight: scrollMetrics.viewportHeight,
			scrollTop: scrollMetrics.scrollTop,
			sectionTop: scrollMetrics.sectionTop,
		});

		measurement.updateFromLiveMetrics(
			{
				sectionTop: scrollMetrics.sectionTop,
				viewportHeight: scrollMetrics.viewportHeight,
			},
			isStableMeasurement,
		);

		const measurementContext: VirtualListRangeMeasurementContext<
			TLayout,
			TContent
		> = {
			scrollTop: scrollMetrics.scrollTop,
			viewportHeight: scrollMetrics.viewportHeight,
			sectionTop: scrollMetrics.sectionTop,
			isStableMeasurement,
			isScrollActive: false,
			content,
			layout,
			precomputedMountedRange: undefined,
			precomputedRanges: undefined,
		};
		const result = applyRangeMeasurement(measurementContext);
		if (result.kind === "stable") {
			primeLastScrollWindow(measurementContext);
		}
		return result;
	};

	const updateFromCachedMeasurement = (
		content = getCachedContent(),
		options = undefined as TCachedOptions,
		sharedScrollMetrics?: VirtualListSharedScrollMetrics,
	): MeasurementUpdateResult<RowRange> => {
		lastCachedMeasurementContext = null;
		const rootEl = getRootEl();
		if (!getOptionalOwnerWindow(rootEl ?? measurement.scrollContainerEl)) {
			lastScrollWindow = null;
			return SKIPPED_NO_WINDOW;
		}

		// Scalar locals — defer object allocation past early-return paths
		let localScrollTop: number;
		let localViewportHeight: number;
		const localIsScrollActive: boolean =
			sharedScrollMetrics?.isScrollActive ?? false;

		if (sharedScrollMetrics) {
			localScrollTop = sharedScrollMetrics.scrollTop;
			localViewportHeight = sharedScrollMetrics.viewportHeight;
		} else {
			const snapshot = readScrollSnapshot(
				measurement.scrollContainerEl,
				measurement.viewportHeight,
				cachedScrollSnapshot,
				rootEl,
			);
			localScrollTop = snapshot.scrollTop;
			localViewportHeight = snapshot.viewportHeight;
		}

		const localSectionTop = measurement.sectionTop;
		const isStableMeasurement = isStableCachedVirtualListMeasurementFromMetrics(
			hasRenderableContent(content),
			measurement.hasStableScrollMetrics,
			measurement.viewportHeight,
			localScrollTop,
			localViewportHeight,
			localSectionTop,
		);
		if (!isStableMeasurement && shouldSkipUnstableCachedMeasurement?.(options)) {
			lastScrollWindow = null;
			return SKIPPED_UNSTABLE;
		}

		// Allocate lastCachedMeasurementContext only when a consumer exists
		if (onStableScrollMeasurement) {
			lastCachedMeasurementContext = {
				scrollTop: localScrollTop,
				viewportHeight: localViewportHeight,
				sectionTop: localSectionTop,
				isScrollActive: localIsScrollActive,
				...(sharedScrollMetrics
					? { sharedScrollMetrics: { ...sharedScrollMetrics } }
					: {}),
			};
		}

		const layout = getLayout();
		let nextScrollWindowIdentity: ScrollWindowIdentity | null = null;
		let nextScrollWindowRanges: VirtualRanges | null = null;
		let nextStablePreviewScrollTopBand:
			| RangedScrollWindowMeasurement["stablePreviewScrollTopBand"]
			| undefined;
		let nextStableMountedScrollTopBand:
			| MountedScrollWindowMeasurement["stableMountedScrollTopBand"]
			| undefined;
		let nextMountedScrollWindowRange: RowRange | null = null;
		let pendingMountedScrollWindowMeasurement: MountedScrollWindowMeasurement | null =
			null;
		let precomputedRanges: VirtualRanges | undefined;
		let precomputedMountedRange: RowRange | undefined;
		let hasMountedWindowChanged = false;
		if (isStableMeasurement && localIsScrollActive) {
			if (
				activeScrollWindowComparison === "mounted-only" &&
				resolveMountedScrollWindowMeasurement
			) {
				const mountedScrollWindowMeasurement =
					resolveMountedScrollWindowMeasurement(
						localScrollTop,
						localViewportHeight,
						localSectionTop,
						content,
						layout,
					);
				if (mountedScrollWindowMeasurement) {
					precomputedMountedRange = mountedScrollWindowMeasurement.mounted;
					hasMountedWindowChanged = !isSameMountedScrollWindow(
						lastScrollWindow,
						mountedScrollWindowMeasurement.identity,
						mountedScrollWindowMeasurement.mounted,
					);
					if (!hasMountedWindowChanged) {
						if (!resolveScrollWindowMeasurement) {
							return returnStable(mountedScrollWindowMeasurement.mounted);
						}
						if (
							isWithinStableMountedScrollWindow(
								lastScrollWindow,
								mountedScrollWindowMeasurement.identity,
								mountedScrollWindowMeasurement.mounted,
								localScrollTop,
							)
						) {
							return returnStable(mountedScrollWindowMeasurement.mounted);
						}
						if (
							isWithinStablePreviewScrollWindow(
								lastScrollWindow,
								mountedScrollWindowMeasurement.identity,
								mountedScrollWindowMeasurement.mounted,
								localScrollTop,
							)
						) {
							return returnStable(mountedScrollWindowMeasurement.mounted);
						}
					}
					pendingMountedScrollWindowMeasurement =
						mountedScrollWindowMeasurement;
				}
			}

			const scrollWindowMeasurement =
				resolveScrollWindowMeasurement?.(
					localScrollTop,
					localViewportHeight,
					localSectionTop,
					content,
					layout,
					precomputedMountedRange,
				) ?? null;
			if (scrollWindowMeasurement) {
				precomputedRanges = scrollWindowMeasurement.ranges;
				if (
					isSameRangedScrollWindow(
						lastScrollWindow,
						scrollWindowMeasurement.identity,
						scrollWindowMeasurement.ranges,
						"visible-and-mounted",
					)
				) {
					return returnStable(scrollWindowMeasurement.ranges.mounted);
				}
				if (
					activeScrollWindowComparison === "mounted-only" &&
					pendingMountedScrollWindowMeasurement &&
					isSameMountedScrollWindow(
						lastScrollWindow,
						scrollWindowMeasurement.identity,
						scrollWindowMeasurement.ranges.mounted,
					)
				) {
					onActiveScrollPreviewRangeMeasurement?.(
						scrollWindowMeasurement.ranges,
					);
					lastScrollWindow = updateMountedAndPreviewScrollWindow(
						lastScrollWindow,
						scrollWindowMeasurement.identity,
						scrollWindowMeasurement.ranges,
						scrollWindowMeasurement.stablePreviewScrollTopBand,
						pendingMountedScrollWindowMeasurement.stableMountedScrollTopBand,
					);
					return returnStable(scrollWindowMeasurement.ranges.mounted);
				}
				nextScrollWindowIdentity = scrollWindowMeasurement.identity;
				nextScrollWindowRanges = scrollWindowMeasurement.ranges;
				nextStablePreviewScrollTopBand =
					scrollWindowMeasurement.stablePreviewScrollTopBand;
				if (
					pendingMountedScrollWindowMeasurement &&
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
			} else if (pendingMountedScrollWindowMeasurement) {
				nextScrollWindowIdentity =
					pendingMountedScrollWindowMeasurement.identity;
				nextMountedScrollWindowRange =
					pendingMountedScrollWindowMeasurement.mounted;
				nextStableMountedScrollTopBand =
					pendingMountedScrollWindowMeasurement.stableMountedScrollTopBand;
			} else {
				lastScrollWindow = null;
			}
		} else {
			lastScrollWindow = null;
		}

		let measurementContext = cachedRangeMeasurementContext;
		if (onStableScrollMeasurement || !measurementContext) {
			measurementContext = {
				scrollTop: localScrollTop,
				viewportHeight: localViewportHeight,
				sectionTop: localSectionTop,
				isStableMeasurement,
				isScrollActive: localIsScrollActive,
				content,
				layout,
				precomputedMountedRange: undefined,
				precomputedRanges: undefined,
			};
			if (!onStableScrollMeasurement) {
				cachedRangeMeasurementContext = measurementContext;
			}
		} else {
			measurementContext.scrollTop = localScrollTop;
			measurementContext.viewportHeight = localViewportHeight;
			measurementContext.sectionTop = localSectionTop;
			measurementContext.isStableMeasurement = isStableMeasurement;
			measurementContext.isScrollActive = localIsScrollActive;
			measurementContext.content = content;
			measurementContext.layout = layout;
		}
		measurementContext.precomputedMountedRange = precomputedMountedRange;
		measurementContext.precomputedRanges = precomputedRanges;

		const result = applyRangeMeasurement(measurementContext);
		if (result.kind === "stable") {
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
			} else if (nextMountedScrollWindowRange) {
				lastScrollWindow = updateMountedScrollWindow(
					lastScrollWindow,
					nextScrollWindowIdentity,
					nextMountedScrollWindowRange,
					nextStableMountedScrollTopBand,
				);
			}
			if (!measurementContext.isScrollActive) {
				primeLastScrollWindow(measurementContext);
			}
		} else if (lastScrollWindow === null && pendingMountedScrollWindowMeasurement) {
			// The full range measurement did not stabilize yet (e.g. the visible
			// range is still bootstrapping on the first scroll frame), but the
			// mounted window itself is a sound estimate. Prime the gate with a
			// mounted-only window so the next frame can short-circuit via
			// isSameMountedScrollWindow instead of recomputing ranges.
			lastScrollWindow = createMountedScrollWindow(
				pendingMountedScrollWindowMeasurement.identity,
				pendingMountedScrollWindowMeasurement.mounted,
				pendingMountedScrollWindowMeasurement.stableMountedScrollTopBand,
			);
		} else {
			lastScrollWindow = null;
		}
		return result;
	};

	const runLayoutMeasurement = (scheduleFollowupScroll = true) => {
		const rootEl = getRootEl();
		if (!rootEl || !getOptionalOwnerWindow(rootEl)) {
			return;
		}

		const rootRect = rootEl.getBoundingClientRect();
		const layoutMeasurement = resolveLayoutMeasurement(rootEl, rootRect);
		const layoutChanged = !isSameLayout(getLayout(), layoutMeasurement.layout);
		const visibleRangeResult = updateFromLiveMeasurement(
			layoutMeasurement.content,
			layoutMeasurement.layout,
			rootRect,
		);

		if (layoutChanged) {
			setLayout(layoutMeasurement.layout);
		}
		onLayoutMeasurementApplied?.(layoutMeasurement);

		if (!layoutMeasurement.hasStableLayout) {
			scheduleUnstableMeasurementRetry();
			return;
		}
		if (visibleRangeResult.kind === "bootstrapped") {
			scheduleUnstableMeasurementRetry();
			return;
		}
		if (visibleRangeResult.kind === "skipped") {
			scheduleUnstableMeasurementRetry();
			return;
		}

		resetUnstableMeasurementRetry();
		if (scheduleFollowupScroll) {
			scheduleScrollMeasurement();
		}
		if (lastLiveMeasurementContext) {
			onStableLayoutMeasurement?.(lastLiveMeasurementContext);
		}
	};

	const runScrollMeasurement = (
		sharedScrollMetrics?: VirtualListSharedScrollMetrics,
	) => {
		const visibleRangeResult = updateFromCachedMeasurement(
			getCachedContent(),
			undefined as TCachedOptions,
			sharedScrollMetrics,
		);
		if (visibleRangeResult.kind !== "stable") {
			scheduleUnstableMeasurementRetry();
			return;
		}

		resetUnstableMeasurementRetry();
		if (lastCachedMeasurementContext) {
			onStableScrollMeasurement?.(lastCachedMeasurementContext);
		}
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

	const INITIAL_STABILIZATION_MAX_PASSES = 2;
	let initialStabilizationPassCount = 0;
	let initialStabilizationCompleted = false;
	let initialStabilizationCancelledByScroll = false;

	const runInitialStabilizationMeasurement = () => {
		if (initialStabilizationCompleted) {
			return;
		}

		if (initialStabilizationCancelledByScroll) {
			return;
		}

		const rootEl = getRootEl();
		if (!rootEl || !getOptionalOwnerWindow(rootEl)) {
			return;
		}

		initialStabilizationPassCount += 1;

		runLayoutMeasurement();

		if (measurement.hasStableScrollMetrics && measurement.hasStableVisibleRange) {
			initialStabilizationCompleted = true;
			return;
		}

		if (initialStabilizationPassCount < INITIAL_STABILIZATION_MAX_PASSES) {
			initialStabilizationTask.schedule();
		}
	};

	const initialStabilizationTask = createPostPaintVirtualListTask(
		() => {
			runInitialStabilizationMeasurement();
		},
		2,
		() => getOptionalOwnerWindow(getRootEl()),
	);

	const scheduleInitialStabilizationMeasurement = () => {
		if (
			initialStabilizationCompleted ||
			initialStabilizationCancelledByScroll ||
			initialStabilizationTask.isScheduled()
		) {
			return;
		}

		initialStabilizationTask.schedule();
	};

	const cancelInitialStabilizationMeasurement = () => {
		// If scroll metrics and the visible range are already stable, the
		// post-paint stabilization has effectively succeeded even if the
		// scheduled follow-up pass has not run yet. Treat it as completed so
		// the warmed scroll-window gate (primeLastScrollWindow) is preserved
		// instead of being invalidated by the scroll-start cancellation.
		if (measurement.hasStableScrollMetrics && measurement.hasStableVisibleRange) {
			initialStabilizationCompleted = true;
			initialStabilizationTask.cancel();
			return;
		}

		initialStabilizationCancelledByScroll = true;
		initialStabilizationTask.cancel();
	};

	const observeRoot = (
		rootEl: HTMLElement,
		runWithoutTracking: (callback: () => void) => void,
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
			},
			scheduleLayoutMeasurement:
				bootstrapMeasurementSuppression.scheduleObservedLayoutMeasurement,
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: () => {
				runWithoutTracking(() => {
					bootstrapMeasurementSuppression.suppressForBootstrap();
					runLayoutMeasurement();
					scheduleInitialStabilizationMeasurement();
				});
			},
			cancelInitialStabilizationMeasurement,
			onScrollStart: () => {
				// When the first scroll gesture begins before scroll metrics have
				// stabilized, the cached scroll-measurement path would skip
				// (shouldSkipUnstableCachedMeasurement). Read live metrics once
				// at scroll start so the first scheduled scroll frame can use the
				// cached fast path without another animation-frame hop.
				if (measurement.hasStableScrollMetrics) return;
				if (hasPendingLayoutMeasurement()) return;
				runLayoutMeasurement(false);
			},
		});

		return () => {
			bootstrapMeasurementSuppression.cancel();
			initialStabilizationTask.cancel();
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
		updateFromCachedMeasurement,
		updateFromLiveMeasurement,
	};
}
