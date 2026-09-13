import { getOptionalOwnerWindow } from "shared/ui/dom/realmSafeDom";
import { refreshInlineSurfacePosition } from "shared/ui/dom/inlineSurfaceLayoutController";
import {
	createVirtualScrollWindowRangeResolver,
	type ScrollWindowMeasurement,
	type VirtualScrollWindowRangeRowModel,
} from "../engine/scrollWindowResolver";
import type { VirtualizerEngine } from "../engine/virtualizer";
import { observeVirtualViewport } from "../viewport/observer/scrollerRegistry";
import {
	getScrollMetrics,
	readScrollSnapshot,
	type ProgrammaticScrollSnapshot,
	type VirtualListScrollSnapshot,
} from "../viewport/measurement";
import {
	hasValidCachedVirtualListScrollMetrics,
	hasValidVirtualListScrollMetrics,
} from "../viewport/measurement";
import type { VirtualListSharedScrollMetrics } from "../viewport/measurement";
import type { VirtualRanges, VirtualRowModel } from "../model/types";
import type { VirtualVisibilityPolicy } from "../model/ranges";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import {
	createInitialMeasurementLifecycle,
	createVirtualMeasurementScheduler,
	createVirtualScrollCoverageController,
} from "./measurementLifecycle";
import type {
	PublishedVirtualRangeContext,
	VirtualMeasurement,
	VirtualMeasurementApplicationResult,
	VirtualMeasurementResult,
	VirtualScrollMeasurementReason,
} from "./measurementLifecycle";

export interface VirtualizerMeasurementState {
	sectionTop: number;
	viewportHeight: number;
	hasValidScrollMetrics: boolean;
	measuredWidth: number | null;
	scrollContainerEl: HTMLElement | null;
}

export interface VirtualListLayoutMeasurementResolution<TRowModel> {
	readonly rowModel: TRowModel;
	readonly measurement: VirtualMeasurement;
	readonly isLayoutGeometryStable: boolean;
}

export interface CreateVirtualMeasurementRuntimeOptions<
	TCell,
	TRowModel extends VirtualRowModel<TCell> & VirtualScrollWindowRangeRowModel,
	TMountedBuild,
> {
	measurement: VirtualizerMeasurementState;
	getRootEl(): HTMLElement | null;
	getRowModel(): TRowModel;
	hasRenderableContent(): boolean;
	resolveVisibilityPolicy(rowModel: TRowModel): VirtualVisibilityPolicy;
	resolveLayoutMeasurement(
		measurement: VirtualMeasurement & { readonly sectionRect: DOMRect },
		rootEl: HTMLElement,
		runtimeMeasurement: VirtualizerMeasurementState,
	): VirtualListLayoutMeasurementResolution<TRowModel>;
	onRangePublished?(context: PublishedVirtualRangeContext): void;
	onObservedWidthChange?(width: number): void;
	unstableMeasurementRetryLimit: number;
	frameCoordinator: VirtualFrameCoordinator;
	engine: Pick<
		VirtualizerEngine<TCell, TRowModel, TMountedBuild>,
		"applyRangeMeasurement" | "hasPublishedVisibleRange"
	>;
}

export interface VirtualMeasurementRuntime {
	hasPendingLayoutMeasurement(): boolean;
	scheduleLayoutMeasurement(): void;
	scheduleScrollMeasurement(task?: () => void): void;
	runLayoutMeasurement(): VirtualMeasurementResult;
	runScrollMeasurement(
		sharedScrollMetrics?: VirtualListSharedScrollMetrics,
		reason?: VirtualScrollMeasurementReason,
	): VirtualMeasurementResult;
	flushProgrammaticScrollMeasurement(
		snapshot: ProgrammaticScrollSnapshot,
	): VirtualMeasurementResult;
	suppressNextNativeScroll(scrollTop: number): void;
	observeRoot(
		rootEl: HTMLElement,
		runWithoutTracking?: (callback: () => void) => void,
	): () => void;
	resetScrollWindow(): void;
}

const SKIPPED_NO_ROOT: VirtualMeasurementResult = {
	kind: "skipped",
	reason: "no-root",
};
const SKIPPED_NO_WINDOW: VirtualMeasurementResult = {
	kind: "skipped",
	reason: "no-window",
};
type MutableVirtualMeasurement = {
	-readonly [K in keyof VirtualMeasurement]: VirtualMeasurement[K];
};

/** Owns one virtualizer's DOM measurement transaction and observer lifecycle. */
export function createVirtualMeasurementRuntime<
	TCell,
	TRowModel extends VirtualRowModel<TCell> & VirtualScrollWindowRangeRowModel,
	TMountedBuild,
>({
	measurement,
	getRootEl,
	getRowModel,
	hasRenderableContent,
	resolveVisibilityPolicy,
	resolveLayoutMeasurement,
	onRangePublished,
	onObservedWidthChange,
	unstableMeasurementRetryLimit,
	frameCoordinator,
	engine,
}: CreateVirtualMeasurementRuntimeOptions<
	TCell,
	TRowModel,
	TMountedBuild
>): VirtualMeasurementRuntime {
	const publishedRangeContext: PublishedVirtualRangeContext = {
		scrollTop: 0,
		viewportHeight: 0,
		sectionTop: 0,
		isScrollActive: false,
		sharedScrollMetrics: undefined,
	};
	const rangeResolver = createVirtualScrollWindowRangeResolver<TRowModel>();
	const scrollCoverage = createVirtualScrollCoverageController();
	const reusableScrollSnapshot: VirtualListScrollSnapshot = {
		scrollTop: 0,
		viewportHeight: 0,
	};
	const reusableScrollMeasurement: MutableVirtualMeasurement = {
		scrollTop: 0,
		viewportHeight: 0,
		sectionTop: 0,
		hasValidScrollMetrics: false,
		isScrollActive: false,
		scrollGeneration: 0,
		source: "scroll",
		sharedScrollMetrics: undefined,
	};
	const reusableScrollMeasurementResult: VirtualMeasurementResult = {
		kind: "measured",
		measurement: reusableScrollMeasurement,
	};
	let observedScrollGeneration = 0;
	let hasPendingObservedScrollTop = false;
	let isObservedScrollActive = false;

	function invalidateViewportMeasurement(): void {
		measurement.viewportHeight = 0;
		measurement.hasValidScrollMetrics = false;
	}

	function updateLiveMeasurementState(
		metrics: { sectionTop: number; viewportHeight: number },
		hasValidScrollMetrics: boolean,
	): void {
		measurement.sectionTop = metrics.sectionTop;
		measurement.viewportHeight = metrics.viewportHeight;
		measurement.hasValidScrollMetrics = hasValidScrollMetrics;
	}

	function notifyRangePublished(nextMeasurement: VirtualMeasurement): void {
		if (!onRangePublished) return;
		publishedRangeContext.scrollTop = nextMeasurement.scrollTop;
		publishedRangeContext.viewportHeight = nextMeasurement.viewportHeight;
		publishedRangeContext.sectionTop = nextMeasurement.sectionTop;
		publishedRangeContext.isScrollActive = nextMeasurement.isScrollActive;
		publishedRangeContext.sharedScrollMetrics = nextMeasurement.sharedScrollMetrics;
		onRangePublished(publishedRangeContext);
	}

	function resolveScrollWindowMeasurement(
		nextMeasurement: VirtualMeasurement,
		rowModel: TRowModel,
		visibilityPolicy: VirtualVisibilityPolicy,
	): ScrollWindowMeasurement {
		return rangeResolver.resolveScrollWindowMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			rowModel,
			visibilityPolicy,
		);
	}

	function applyScrollMeasurement(
		nextMeasurement: VirtualMeasurement,
		rowModel: TRowModel,
	): VirtualMeasurementApplicationResult {
		const visibilityPolicy = resolveVisibilityPolicy(rowModel);
		let rangeMeasurement: ScrollWindowMeasurement | null = null;
		let resolvedRanges: VirtualRanges | undefined;
		if (nextMeasurement.hasValidScrollMetrics) {
			rangeMeasurement = resolveScrollWindowMeasurement(
				nextMeasurement,
				rowModel,
				visibilityPolicy,
			);
			resolvedRanges = rangeMeasurement.ranges;
		} else {
			scrollCoverage.reset();
		}

		const rangeApplication = engine.applyRangeMeasurement(
			nextMeasurement,
			rowModel,
			visibilityPolicy,
			resolvedRanges,
		);
		if (rangeApplication.kind !== "stable") {
			scrollCoverage.reset();
			return "rejected";
		}

		scrollCoverage.setCoverageBand(
			rangeMeasurement
				? scrollCoverage.resolvePublishedCoverageBand(rangeMeasurement)
				: undefined,
		);
		notifyRangePublished(nextMeasurement);
		return "applied";
	}

	function applyLayoutMeasurement(
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult {
		const rootEl = getRootEl();
		if (!rootEl || !nextMeasurement.sectionRect) {
			scrollCoverage.reset();
			return "skipped";
		}

		const resolution = resolveLayoutMeasurement(
			nextMeasurement as VirtualMeasurement & { readonly sectionRect: DOMRect },
			rootEl,
			measurement,
		);
		const effectiveMeasurement = resolution.measurement;
		const visibilityPolicy = resolveVisibilityPolicy(resolution.rowModel);
		let rangeMeasurement: ScrollWindowMeasurement | null = null;
		let resolvedRanges: VirtualRanges | undefined;
		if (effectiveMeasurement.hasValidScrollMetrics) {
			rangeMeasurement = resolveScrollWindowMeasurement(
				effectiveMeasurement,
				resolution.rowModel,
				visibilityPolicy,
			);
			resolvedRanges = rangeMeasurement.ranges;
		}
		const rangeApplication = engine.applyRangeMeasurement(
			{ ...effectiveMeasurement, isScrollActive: false },
			resolution.rowModel,
			visibilityPolicy,
			resolvedRanges,
		);
		if (rangeApplication.kind !== "stable" || !resolution.isLayoutGeometryStable) {
			scrollCoverage.reset();
			return "rejected";
		}

		scrollCoverage.setCoverageBand(
			rangeMeasurement
				? scrollCoverage.resolvePublishedCoverageBand(rangeMeasurement)
				: undefined,
		);
		scheduleScrollMeasurementAfterLayout(effectiveMeasurement);
		notifyRangePublished(effectiveMeasurement);
		return "applied";
	}

	function applyMeasurement(
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult {
		return nextMeasurement.source === "layout"
			? applyLayoutMeasurement(nextMeasurement)
			: applyScrollMeasurement(nextMeasurement, getRowModel());
	}

	function publishMeasurement(
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult {
		const result = applyMeasurement(nextMeasurement);
		scrollCoverage.publish();
		return result;
	}

	function runLayoutMeasurement(): VirtualMeasurementResult {
		const rootEl = getRootEl();
		if (!rootEl) return SKIPPED_NO_ROOT;
		if (!getOptionalOwnerWindow(rootEl)) return SKIPPED_NO_WINDOW;

		refreshInlineSurfacePosition(measurement.scrollContainerEl);
		const sectionRect = rootEl.getBoundingClientRect();
		const scrollMetrics = getScrollMetrics(
			rootEl,
			measurement.scrollContainerEl,
			sectionRect,
		);
		const hasValidScrollMetrics = hasValidVirtualListScrollMetrics({
			hasRenderableContent: hasRenderableContent(),
			rootRect: sectionRect,
			viewportHeight: scrollMetrics.viewportHeight,
			scrollTop: scrollMetrics.scrollTop,
			sectionTop: scrollMetrics.sectionTop,
		});

		updateLiveMeasurementState(scrollMetrics, hasValidScrollMetrics);
		const nextMeasurement: VirtualMeasurement = {
			scrollTop: scrollMetrics.scrollTop,
			viewportHeight: scrollMetrics.viewportHeight,
			sectionTop: scrollMetrics.sectionTop,
			hasValidScrollMetrics,
			isScrollActive: false,
			scrollGeneration: observedScrollGeneration,
			source: "layout",
			sectionRect,
		};
		const applicationResult = publishMeasurement(nextMeasurement);

		if (hasValidScrollMetrics && applicationResult === "applied") {
			resetUnstableMeasurementRetry();
		} else {
			scheduleUnstableMeasurementRetry();
		}

		return { kind: "measured", measurement: nextMeasurement };
	}

	function runScrollMeasurement(
		sharedScrollMetrics?: VirtualListSharedScrollMetrics,
		reason?: VirtualScrollMeasurementReason,
	): VirtualMeasurementResult {
		const rootEl = getRootEl();
		if (!getOptionalOwnerWindow(rootEl ?? measurement.scrollContainerEl)) {
			return SKIPPED_NO_WINDOW;
		}
		// Idle is the recovery boundary for position changes missed by observers.
		// Ordinary scroll measurements must continue to use cached geometry.
		let idleMetrics: VirtualListScrollSnapshot | undefined;
		if (
			reason === "scroll-idle" &&
			!sharedScrollMetrics?.isScrollActive &&
			rootEl
		) {
			refreshInlineSurfacePosition(measurement.scrollContainerEl);
			const metrics = getScrollMetrics(rootEl, measurement.scrollContainerEl);
			const valid = hasValidVirtualListScrollMetrics({
				hasRenderableContent: hasRenderableContent(),
				rootRect: metrics.sectionRect,
				...metrics,
			});
			if (
				metrics.sectionTop !== measurement.sectionTop ||
				metrics.viewportHeight !== measurement.viewportHeight ||
				valid !== measurement.hasValidScrollMetrics
			) {
				scrollCoverage.reset();
			}
			updateLiveMeasurementState(metrics, valid);
			idleMetrics = metrics;
			if (sharedScrollMetrics) {
				sharedScrollMetrics = {
					...sharedScrollMetrics,
					scrollTop: metrics.scrollTop,
					viewportHeight: metrics.viewportHeight,
				};
			}
		}
		const snapshot =
			idleMetrics ??
			sharedScrollMetrics ??
			readScrollSnapshot(
				measurement.scrollContainerEl,
				measurement.viewportHeight,
				reusableScrollSnapshot,
				rootEl,
			);
		reusableScrollMeasurement.scrollTop = snapshot.scrollTop;
		reusableScrollMeasurement.viewportHeight = snapshot.viewportHeight;
		reusableScrollMeasurement.sectionTop = measurement.sectionTop;
		reusableScrollMeasurement.isScrollActive =
			sharedScrollMetrics?.isScrollActive ?? false;
		reusableScrollMeasurement.hasValidScrollMetrics =
			hasValidCachedVirtualListScrollMetrics(
				hasRenderableContent(),
				measurement.hasValidScrollMetrics,
				measurement.viewportHeight,
				snapshot.scrollTop,
				snapshot.viewportHeight,
				measurement.sectionTop,
			);
		reusableScrollMeasurement.sharedScrollMetrics = sharedScrollMetrics;
		reusableScrollMeasurement.scrollGeneration =
			sharedScrollMetrics?.scrollGeneration ?? observedScrollGeneration;

		if (
			reason === "scroll-idle" &&
			reusableScrollMeasurement.hasValidScrollMetrics &&
			scrollCoverage.isWithinCoverage(reusableScrollMeasurement.scrollTop)
		) {
			notifyRangePublished(reusableScrollMeasurement);
			resetUnstableMeasurementRetry();
			return reusableScrollMeasurementResult;
		}

		const applicationResult = publishMeasurement(reusableScrollMeasurement);

		if (
			reusableScrollMeasurement.hasValidScrollMetrics &&
			applicationResult === "applied"
		) {
			resetUnstableMeasurementRetry();
		} else {
			scheduleUnstableMeasurementRetry();
		}

		return reusableScrollMeasurementResult;
	}

	function flushProgrammaticScrollMeasurement(
		snapshot: ProgrammaticScrollSnapshot,
	): VirtualMeasurementResult {
		if (measurement.scrollContainerEl !== snapshot.scrollContainerEl) {
			measurement.scrollContainerEl = snapshot.scrollContainerEl;
		}
		if (snapshot.viewportHeight > 0) {
			measurement.viewportHeight = snapshot.viewportHeight;
			measurement.sectionTop = snapshot.sectionTop;
			measurement.hasValidScrollMetrics = true;
		}
		return runScrollMeasurement({
			scrollTop: snapshot.scrollTop,
			viewportHeight: snapshot.viewportHeight,
			frameId: 0,
			isScrollActive: false,
			scrollGeneration: 0,
		});
	}

	function hasSchedulingWindow(): boolean {
		return getOptionalOwnerWindow(getRootEl()) !== null;
	}

	const measurementScheduler = createVirtualMeasurementScheduler({
		frameCoordinator,
		hasSchedulingWindow,
		runLayoutMeasurement,
		runScrollMeasurement,
		unstableMeasurementRetryLimit,
	});
	const {
		hasPendingLayoutMeasurement,
		scheduleLayoutMeasurement,
		scheduleScrollMeasurement,
		scheduleUnstableMeasurementRetry,
		resetUnstableMeasurementRetry,
		cancelAll: cancelAllScheduledMeasurements,
	} = measurementScheduler;

	function scheduleScrollMeasurementAfterLayout(
		layoutMeasurement: VirtualMeasurement,
	): void {
		if (layoutMeasurement.source !== "layout") return;
		if (
			observedScrollGeneration <= layoutMeasurement.scrollGeneration &&
			!hasPendingObservedScrollTop &&
			!isObservedScrollActive
		) {
			return;
		}

		scheduleScrollMeasurement();
	}

	const initialMeasurementLifecycle = createInitialMeasurementLifecycle({
		measurement,
		hasPublishedVisibleRange: engine.hasPublishedVisibleRange,
		runLayoutMeasurement,
		scheduleLayoutMeasurement,
		getRootEl,
		getWindow: () => getOptionalOwnerWindow(getRootEl()),
		frameCoordinator,
	});

	function observeRoot(
		rootEl: HTMLElement,
		runWithoutTracking: (callback: () => void) => void = (callback) => callback(),
	): () => void {
		const observation = observeVirtualViewport({
			rootEl,
			frameCoordinator,
			onWidthChange: (width) => {
				measurement.measuredWidth = width;
				onObservedWidthChange?.(width);
			},
			getCachedViewportHeight: () => measurement.viewportHeight,
			getScrollMeasurementRange: scrollCoverage.getMeasurementRange,
			onScrollStateChange: (generation, hasPendingScrollTop, isScrollActive) => {
				observedScrollGeneration = generation;
				hasPendingObservedScrollTop = hasPendingScrollTop;
				isObservedScrollActive = isScrollActive;
			},
			onScrollContainerChange: (element) => {
				measurement.scrollContainerEl = element;
				invalidateViewportMeasurement();
			},
			scheduleLayoutMeasurement:
				initialMeasurementLifecycle.scheduleObservedLayoutMeasurement,
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: () => {
				runWithoutTracking(() => {
					initialMeasurementLifecycle.suppressForBootstrap();
					runLayoutMeasurement();
					initialMeasurementLifecycle.scheduleStabilization();
				});
			},
			cancelInitialStabilizationMeasurement:
				initialMeasurementLifecycle.cancelBecauseScrollStarted,
			resetMeasurementForObservation: () => {
				initialMeasurementLifecycle.resetForObservation();
				measurementScheduler.resetForObservation();
			},
			onScrollStart: () => {
				if (measurement.hasValidScrollMetrics) return;
				if (hasPendingLayoutMeasurement()) return;
				scheduleLayoutMeasurement();
			},
		});
		scrollCoverage.setObservation(observation);

		return () => {
			scrollCoverage.clearObservation(observation);
			initialMeasurementLifecycle.cancel();
			cancelAllScheduledMeasurements();
			observation();
		};
	}

	return {
		hasPendingLayoutMeasurement,
		scheduleLayoutMeasurement,
		scheduleScrollMeasurement,
		runLayoutMeasurement,
		runScrollMeasurement,
		flushProgrammaticScrollMeasurement,
		suppressNextNativeScroll: scrollCoverage.suppressNextNativeScroll,
		observeRoot,
		resetScrollWindow: scrollCoverage.reset,
	};
}
