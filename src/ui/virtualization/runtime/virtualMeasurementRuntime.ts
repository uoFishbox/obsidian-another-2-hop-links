import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { getOptionalOwnerWindow } from "ui/shared/dom/realmSafeDom";
import {
	createVirtualScrollWindowRangeResolver,
	type MountedScrollWindowMeasurement,
	type RangedScrollWindowMeasurement,
	type VirtualScrollWindowRangeRowModel,
} from "../engine/scrollWindowResolver";
import type { MountedVirtualCellsBuild } from "../engine/snapshotComputation";
import type { VirtualizerEngine } from "../engine/virtualizer";
import { observeVirtualViewport } from "../viewport/observer/observeVirtualViewport";
import {
	getScrollMetrics,
	readScrollSnapshot,
	type ProgrammaticScrollSnapshot,
	type VirtualListScrollSnapshot,
} from "../viewport/measurementAdapter";
import {
	isStableCachedVirtualListMeasurementFromMetrics,
	isStableVirtualListMeasurement,
} from "../viewport/measurementStability";
import type { VirtualListSharedScrollMetrics } from "../viewport/sharedScrollMetrics";
import type { RowRange } from "../model/rowRange";
import type {
	MountedVirtualCell,
	VirtualRanges,
	VirtualRowModel,
} from "../model/types";
import type { VirtualVisibilityPolicy } from "../model/ranges";
import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";
import { markVirtualScrollMeasurementRun } from "./virtualScrollMeasurementEpoch";
import { createInitialMeasurementLifecycle } from "./initialMeasurement";
import { createVirtualMeasurementScheduler } from "./measurementScheduler";
import { createVirtualScrollCoverageController } from "./scrollCoverageController";
import type {
	RunVirtualScrollMeasurementOptions,
	VirtualListStableMeasurementContext,
	VirtualMeasurement,
	VirtualMeasurementApplicationResult,
	VirtualMeasurementResult,
	VirtualScrollMeasurementReason,
} from "./measurementTypes";

export interface VirtualizerMeasurementState {
	sectionTop: number;
	viewportHeight: number;
	hasStableScrollMetrics: boolean;
	measuredWidth: number | null;
	scrollContainerEl: HTMLElement | null;
}

export interface VirtualListLayoutMeasurementResolution<TContext> {
	readonly context: TContext;
	readonly measurement: VirtualMeasurement;
	readonly isStable: boolean;
}

export interface CreateVirtualMeasurementRuntimeOptions<
	TCell,
	TRowModel extends VirtualRowModel<TCell> & VirtualScrollWindowRangeRowModel,
	TContext,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	measurement: VirtualizerMeasurementState;
	getRootEl(): HTMLElement | null;
	getContext(): TContext;
	hasRenderableContent(): boolean;
	resolveRowModel(context: TContext): TRowModel;
	resolveVisibilityPolicy(context: TContext): VirtualVisibilityPolicy;
	resolveLayoutMeasurement(
		measurement: VirtualMeasurement & { readonly sectionRect: DOMRect },
		rootEl: HTMLElement,
		runtimeMeasurement: VirtualizerMeasurementState,
	): VirtualListLayoutMeasurementResolution<TContext>;
	onStableMeasurement?(context: VirtualListStableMeasurementContext): void;
	onObservedWidthChange?(width: number): void;
	unstableMeasurementRetryLimit: number;
	frameCoordinator: VirtualFrameCoordinator;
	engine: Pick<
		VirtualizerEngine<TCell, TRowModel, TContext, TMountedCell, TMountedBuild>,
		"applyRangeMeasurement" | "hasStableVisibleRange"
	>;
}

export interface VirtualMeasurementRuntime {
	hasPendingLayoutMeasurement(): boolean;
	scheduleLayoutMeasurement(): void;
	scheduleScrollMeasurement(task?: () => void): void;
	runLayoutMeasurement(): VirtualMeasurementResult;
	runScrollMeasurement(
		sharedScrollMetrics?: VirtualListSharedScrollMetrics,
		optionsOrReason?:
			| RunVirtualScrollMeasurementOptions
			| VirtualScrollMeasurementReason,
	): VirtualMeasurementResult;
	flushProgrammaticScrollMeasurement(
		snapshot: ProgrammaticScrollSnapshot,
		options?: RunVirtualScrollMeasurementOptions,
	): VirtualMeasurementResult;
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
const SKIPPED_UNCHANGED_SCROLL: VirtualMeasurementResult = {
	kind: "skipped",
	reason: "unchanged-scroll",
};
const EMPTY_RUN_SCROLL_MEASUREMENT_OPTIONS: RunVirtualScrollMeasurementOptions = {};

type MutableVirtualMeasurement = {
	-readonly [K in keyof VirtualMeasurement]: VirtualMeasurement[K];
};

/** Owns one virtualizer's DOM measurement transaction and observer lifecycle. */
export function createVirtualMeasurementRuntime<
	TCell,
	TRowModel extends VirtualRowModel<TCell> & VirtualScrollWindowRangeRowModel,
	TContext,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>({
	measurement,
	getRootEl,
	getContext,
	hasRenderableContent,
	resolveRowModel,
	resolveVisibilityPolicy,
	resolveLayoutMeasurement,
	onStableMeasurement,
	onObservedWidthChange,
	unstableMeasurementRetryLimit,
	frameCoordinator,
	engine,
}: CreateVirtualMeasurementRuntimeOptions<
	TCell,
	TRowModel,
	TContext,
	TMountedCell,
	TMountedBuild
>): VirtualMeasurementRuntime {
	const stableMeasurementContext: VirtualListStableMeasurementContext = {
		scrollTop: 0,
		viewportHeight: 0,
		sectionTop: 0,
		isScrollActive: false,
		sharedScrollMetrics: undefined,
	};
	const rangeResolver = createVirtualScrollWindowRangeResolver<TRowModel, TContext>({
		resolveRowModel,
		resolveVisibilityPolicy,
		resolveStableMountedScrollTopBand: true,
	});
	const scrollCoverage = createVirtualScrollCoverageController();
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

	function invalidateViewportMeasurement(): void {
		measurement.viewportHeight = 0;
		measurement.hasStableScrollMetrics = false;
	}

	function updateLiveMeasurementState(
		metrics: { sectionTop: number; viewportHeight: number },
		isStable: boolean,
	): void {
		measurement.sectionTop = metrics.sectionTop;
		measurement.viewportHeight = metrics.viewportHeight;
		measurement.hasStableScrollMetrics = isStable;
	}

	function notifyStableMeasurement(nextMeasurement: VirtualMeasurement): void {
		if (!onStableMeasurement) return;
		stableMeasurementContext.scrollTop = nextMeasurement.scrollTop;
		stableMeasurementContext.viewportHeight = nextMeasurement.viewportHeight;
		stableMeasurementContext.sectionTop = nextMeasurement.sectionTop;
		stableMeasurementContext.isScrollActive = nextMeasurement.isScrollActive;
		stableMeasurementContext.sharedScrollMetrics =
			nextMeasurement.sharedScrollMetrics;
		onStableMeasurement(stableMeasurementContext);
	}

	function resolveMountedScrollWindowMeasurement(
		nextMeasurement: VirtualMeasurement,
		context: TContext,
	): MountedScrollWindowMeasurement {
		return rangeResolver.resolveMountedScrollWindowMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			context,
		);
	}

	function resolveRangedScrollWindowMeasurement(
		nextMeasurement: VirtualMeasurement,
		context: TContext,
		precomputedMountedRange?: RowRange,
	): RangedScrollWindowMeasurement {
		return rangeResolver.resolveScrollWindowMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			context,
			precomputedMountedRange,
		);
	}

	function applyScrollMeasurement(
		nextMeasurement: VirtualMeasurement,
		context: TContext,
	): VirtualMeasurementApplicationResult {
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualScroll.applyScrollMeasurement");
		}

		let mountedMeasurement: MountedScrollWindowMeasurement | null = null;
		let rangedMeasurement: RangedScrollWindowMeasurement | null = null;
		let resolvedRanges: VirtualRanges | undefined;
		if (nextMeasurement.isStableMeasurement) {
			mountedMeasurement = resolveMountedScrollWindowMeasurement(
				nextMeasurement,
				context,
			);
			rangedMeasurement = resolveRangedScrollWindowMeasurement(
				nextMeasurement,
				context,
				mountedMeasurement.mounted,
			);
			resolvedRanges = rangedMeasurement.ranges;
		} else {
			scrollCoverage.reset();
		}

		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualScroll.rangeMeasurementApplied");
		}
		const result = engine.applyRangeMeasurement(
			nextMeasurement,
			context,
			resolvedRanges,
		);
		if (process.env.NODE_ENV !== "production" && result.kind === "stable") {
			recordCCLDevMeasurement(
				result.updateKind === "reused"
					? "virtualScroll.rangeMeasurementReused"
					: "virtualScroll.rangeMeasurementChanged",
			);
		}

		if (result.kind !== "stable") {
			scrollCoverage.reset();
			return "unstable";
		}

		scrollCoverage.setCoverageBand(
			mountedMeasurement && rangedMeasurement
				? scrollCoverage.resolvePublishedCoverageBand(
						mountedMeasurement,
						rangedMeasurement,
					)
				: undefined,
		);
		notifyStableMeasurement(nextMeasurement);
		return "stable";
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
		let mountedMeasurement: MountedScrollWindowMeasurement | null = null;
		let rangedMeasurement: RangedScrollWindowMeasurement | null = null;
		let resolvedRanges: VirtualRanges | undefined;
		if (effectiveMeasurement.isStableMeasurement) {
			mountedMeasurement = resolveMountedScrollWindowMeasurement(
				effectiveMeasurement,
				resolution.context,
			);
			rangedMeasurement = resolveRangedScrollWindowMeasurement(
				effectiveMeasurement,
				resolution.context,
				mountedMeasurement.mounted,
			);
			resolvedRanges = rangedMeasurement.ranges;
		}
		const result = engine.applyRangeMeasurement(
			{ ...effectiveMeasurement, isScrollActive: false },
			resolution.context,
			resolvedRanges,
		);
		if (result.kind !== "stable" || !resolution.isStable) {
			scrollCoverage.reset();
			return "unstable";
		}

		scrollCoverage.setCoverageBand(
			mountedMeasurement && rangedMeasurement
				? scrollCoverage.resolvePublishedCoverageBand(
						mountedMeasurement,
						rangedMeasurement,
					)
				: undefined,
		);
		scheduleScrollMeasurementAfterLayout(effectiveMeasurement);
		notifyStableMeasurement(effectiveMeasurement);
		return "stable";
	}

	function applyMeasurement(
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult {
		return nextMeasurement.source === "layout"
			? applyLayoutMeasurement(nextMeasurement)
			: applyScrollMeasurement(nextMeasurement, getContext());
	}

	function rememberPublishedScrollMeasurement(
		nextMeasurement: VirtualMeasurement,
	): void {
		hasLastPublishedScrollMeasurement = true;
		lastPublishedScrollTop = nextMeasurement.scrollTop;
		lastPublishedViewportHeight = nextMeasurement.viewportHeight;
		lastPublishedSectionTop = nextMeasurement.sectionTop;
		lastPublishedIsStableMeasurement = nextMeasurement.isStableMeasurement;
		lastPublishedIsScrollActive = nextMeasurement.isScrollActive;
	}

	function isUnchangedPublishedScrollMeasurement(
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		isStableMeasurement: boolean,
		isScrollActive: boolean,
	): boolean {
		return (
			hasLastPublishedScrollMeasurement &&
			isStableMeasurement &&
			lastPublishedIsStableMeasurement &&
			lastPublishedScrollTop === scrollTop &&
			lastPublishedViewportHeight === viewportHeight &&
			lastPublishedSectionTop === sectionTop &&
			lastPublishedIsStableMeasurement === isStableMeasurement &&
			lastPublishedIsScrollActive === isScrollActive
		);
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

		const sectionRect = rootEl.getBoundingClientRect();
		const scrollMetrics = getScrollMetrics(
			rootEl,
			measurement.scrollContainerEl,
			sectionRect,
		);
		const isStableMeasurement = isStableVirtualListMeasurement({
			hasRenderableContent: hasRenderableContent(),
			rootRect: sectionRect,
			viewportHeight: scrollMetrics.viewportHeight,
			scrollTop: scrollMetrics.scrollTop,
			sectionTop: scrollMetrics.sectionTop,
		});

		updateLiveMeasurementState(scrollMetrics, isStableMeasurement);
		hasLastPublishedScrollMeasurement = false;

		const nextMeasurement: VirtualMeasurement = {
			scrollTop: scrollMetrics.scrollTop,
			viewportHeight: scrollMetrics.viewportHeight,
			sectionTop: scrollMetrics.sectionTop,
			isStableMeasurement,
			isScrollActive: false,
			scrollGeneration: observedScrollGeneration,
			source: "layout",
			sectionRect,
		};
		const applicationResult = publishMeasurement(nextMeasurement);

		if (isStableMeasurement && applicationResult === "stable") {
			resetUnstableMeasurementRetry();
		} else {
			scheduleUnstableMeasurementRetry();
		}

		return { kind: "measured", measurement: nextMeasurement };
	}

	function runScrollMeasurement(
		sharedScrollMetrics?: VirtualListSharedScrollMetrics,
		optionsOrReason:
			| RunVirtualScrollMeasurementOptions
			| VirtualScrollMeasurementReason = EMPTY_RUN_SCROLL_MEASUREMENT_OPTIONS,
	): VirtualMeasurementResult {
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
		const snapshot =
			sharedScrollMetrics ??
			readScrollSnapshot(
				measurement.scrollContainerEl,
				measurement.viewportHeight,
				cachedScrollSnapshot,
				rootEl,
			);
		scrollMeasurement.scrollTop = snapshot.scrollTop;
		scrollMeasurement.viewportHeight = snapshot.viewportHeight;
		scrollMeasurement.sectionTop = measurement.sectionTop;
		scrollMeasurement.isScrollActive = sharedScrollMetrics?.isScrollActive ?? false;
		scrollMeasurement.isStableMeasurement =
			isStableCachedVirtualListMeasurementFromMetrics(
				hasRenderableContent(),
				measurement.hasStableScrollMetrics,
				measurement.viewportHeight,
				snapshot.scrollTop,
				snapshot.viewportHeight,
				measurement.sectionTop,
			);
		scrollMeasurement.sharedScrollMetrics = sharedScrollMetrics;
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
	}

	function flushProgrammaticScrollMeasurement(
		snapshot: ProgrammaticScrollSnapshot,
		options: RunVirtualScrollMeasurementOptions = EMPTY_RUN_SCROLL_MEASUREMENT_OPTIONS,
	): VirtualMeasurementResult {
		if (measurement.scrollContainerEl !== snapshot.scrollContainerEl) {
			measurement.scrollContainerEl = snapshot.scrollContainerEl;
		}
		if (snapshot.viewportHeight > 0) {
			measurement.viewportHeight = snapshot.viewportHeight;
			measurement.sectionTop = snapshot.sectionTop;
			measurement.hasStableScrollMetrics = true;
		}
		return runScrollMeasurement(
			{
				scrollTop: snapshot.scrollTop,
				viewportHeight: snapshot.viewportHeight,
				frameId: 0,
				isScrollActive: false,
				scrollGeneration: 0,
			},
			options,
		);
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

		pendingScrollMeasurementReason = "post-layout";
		scheduleScrollMeasurement();
	}

	const initialMeasurementLifecycle = createInitialMeasurementLifecycle({
		measurement,
		hasStableVisibleRange: engine.hasStableVisibleRange,
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
				if (measurement.hasStableScrollMetrics) return;
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
		observeRoot,
		resetScrollWindow: scrollCoverage.reset,
	};
}
