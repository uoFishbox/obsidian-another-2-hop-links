import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { getOptionalOwnerWindow } from "ui/shared/dom/realmSafeDom";
import { CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES } from "../cardVirtualListPolicy";
import {
	createVirtualScrollWindowRangeResolver,
	type MountedScrollWindowMeasurement,
	type RangedScrollWindowMeasurement,
	type StableScrollTopBand,
	type VirtualScrollWindowRangeRowModel,
} from "../core/scrollWindowMeasurement";
import {
	computeVirtualListSnapshot,
	createEmptyVirtualListComputation,
	recomputeVirtualListSnapshot,
	type MountedVirtualCellsBuild,
	type VirtualListComputation,
	type VirtualListSnapshot,
} from "../core/virtualListEngine";
import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
} from "../core/residentSlotAllocator";
import {
	observeVirtualListViewport,
	type ScrollMeasurementRange,
	type VirtualListViewportObservation,
} from "../dom/virtualListDomObserver";
import {
	getScrollMetrics,
	readScrollSnapshot,
	type MeasurementUpdateResult,
	type ProgrammaticScrollSnapshot,
	type VirtualListScrollSnapshot,
} from "../dom/virtualListMeasurementAdapter";
import {
	isStableCachedVirtualListMeasurementFromMetrics,
	isStableVirtualListMeasurement,
} from "../dom/virtualListMeasurementStability";
import type { VirtualListSharedScrollMetrics } from "../dom/sharedScrollMetrics";
import type {
	RunVirtualScrollMeasurementOptions,
	VirtualListStableMeasurementContext,
	VirtualMeasurement,
	VirtualMeasurementApplicationResult,
	VirtualMeasurementResult,
	VirtualScrollMeasurementReason,
} from "../dom/virtualMeasurement";
import type { RowRange } from "../rowRange";
import type { VirtualFrameCoordinator } from "../scheduling/frameCoordinator";
import { markVirtualScrollMeasurementRun } from "../scheduling/virtualScrollMeasurementFrame";
import { createInitialMeasurementLifecycle } from "../dom/initialMeasurementLifecycle";
import type { MountedVirtualCell, VirtualRanges, VirtualRowModel } from "../types";
import { computeVirtualRanges, type VirtualVisibilityPolicy } from "../virtualRanges";

export type {
	RunVirtualScrollMeasurementOptions,
	VirtualListStableMeasurementContext,
	VirtualMeasurement,
	VirtualMeasurementApplicationResult,
	VirtualMeasurementResult,
	VirtualScrollMeasurementReason,
} from "../dom/virtualMeasurement";

export interface VirtualListLayoutMeasurementResolution<TContext> {
	readonly context: TContext;
	readonly measurement: VirtualMeasurement;
	readonly isStable: boolean;
}

export interface UseVirtualListRuntimeOptions<
	TCell,
	TRowModel extends VirtualRowModel<TCell> & VirtualScrollWindowRangeRowModel,
	TContext,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	getRootEl(): HTMLElement | null;
	getContext(): TContext;
	hasRenderableContent(): boolean;
	resolveRowModel(context: TContext): TRowModel;
	resolveVisibilityPolicy(context: TContext): VirtualVisibilityPolicy;
	buildMountedCells(params: {
		rowModel: TRowModel;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
		rowSlotAllocator: ResidentRowSlotAllocator;
	}): TMountedBuild;
	onSnapshotUpdated?(
		snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
	): void;
	resolveLayoutMeasurement(
		measurement: VirtualMeasurement & { readonly sectionRect: DOMRect },
		rootEl: HTMLElement,
		runtimeMeasurement: VirtualListRuntimeMeasurementState,
	): VirtualListLayoutMeasurementResolution<TContext>;
	onStableMeasurement?(context: VirtualListStableMeasurementContext): void;
	onObservedWidthChange?(width: number): void;
	frameCoordinator: VirtualFrameCoordinator;
}

export interface VirtualListRuntimeMeasurementState {
	sectionTop: number;
	viewportHeight: number;
	hasStableScrollMetrics: boolean;
	measuredWidth: number | null;
	scrollContainerEl: HTMLElement | null;
}

type MutableVirtualMeasurement = {
	-readonly [K in keyof VirtualMeasurement]: VirtualMeasurement[K];
};

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

/**
 * Owns the viewport measurement transaction from DOM acquisition through
 * scroll-window resolution, engine publication, and observer coverage update.
 */
export function useVirtualListRuntime<
	TCell,
	TRowModel extends VirtualRowModel<TCell> & VirtualScrollWindowRangeRowModel,
	TContext,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>({
	getRootEl,
	getContext,
	hasRenderableContent,
	resolveRowModel,
	resolveVisibilityPolicy,
	buildMountedCells,
	onSnapshotUpdated,
	resolveLayoutMeasurement,
	onStableMeasurement,
	onObservedWidthChange,
	frameCoordinator,
}: UseVirtualListRuntimeOptions<
	TCell,
	TRowModel,
	TContext,
	TMountedCell,
	TMountedBuild
>) {
	const measurement = $state<VirtualListRuntimeMeasurementState>({
		sectionTop: 0,
		viewportHeight: 0,
		hasStableScrollMetrics: false,
		measuredWidth: null,
		scrollContainerEl: null,
	});
	const invalidateViewportMeasurement = (): void => {
		measurement.viewportHeight = 0;
		measurement.hasStableScrollMetrics = false;
	};
	const updateLiveMeasurementState = (
		metrics: { sectionTop: number; viewportHeight: number },
		isStable: boolean,
	): void => {
		measurement.sectionTop = metrics.sectionTop;
		measurement.viewportHeight = metrics.viewportHeight;
		measurement.hasStableScrollMetrics = isStable;
	};
	let latestSnapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> | null =
		null;
	let hasStableVisibleRange = false;
	let mountedBuildState = $state.raw<TMountedBuild | null>(null);
	let totalHeightState = $state<number | null>(null);
	const rowSlotAllocator = createResidentRowSlotAllocator();

	const buildMountedCellsForEngine = (params: {
		rowModel: VirtualRowModel<TCell>;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
	}): TMountedBuild =>
		buildMountedCells({
			rowModel: params.rowModel as TRowModel,
			rowRange: params.rowRange,
			ranges: params.ranges,
			previousBuild: params.previousBuild,
			rowSlotAllocator,
		});

	function commitComputation(
		result: VirtualListComputation<TCell, TMountedCell, TMountedBuild>,
	): void {
		const nextSnapshot = result.snapshot;
		if (latestSnapshot === nextSnapshot) {
			return;
		}

		latestSnapshot = nextSnapshot;
		if (mountedBuildState !== nextSnapshot.mountedBuild) {
			mountedBuildState = nextSnapshot.mountedBuild;
		}
		if (totalHeightState !== nextSnapshot.totalHeight) {
			totalHeightState = nextSnapshot.totalHeight;
		}
		onSnapshotUpdated?.(nextSnapshot);
	}

	function applyRangeMeasurement(
		nextMeasurement: VirtualMeasurement,
		context: TContext,
		precomputedRanges?: VirtualRanges,
	): MeasurementUpdateResult<RowRange> {
		const rowModel = resolveRowModel(context);
		const previousSnapshot = latestSnapshot;
		const previousMountedBuild = previousSnapshot?.mountedBuild ?? null;
		const visibilityPolicy = resolveVisibilityPolicy(context);
		const rangesResult = computeVirtualRanges({
			rowModel,
			scrollTop: nextMeasurement.scrollTop,
			viewportHeight: nextMeasurement.viewportHeight,
			sectionTop: nextMeasurement.sectionTop,
			isStableMeasurement: nextMeasurement.isStableMeasurement,
			hasStableVisibleRange,
			currentMountedRange: previousSnapshot?.ranges.mounted ?? {
				start: 0,
				end: 0,
			},
			bootstrapRows: visibilityPolicy.bootstrapRows,
			mountedOverscanPx: visibilityPolicy.mountedOverscanPx,
			previewOverscanPx: visibilityPolicy.previewOverscanPx ?? 0,
			precomputedRanges,
		});
		const result = computeVirtualListSnapshot({
			rowModel,
			rangesResult,
			previous: previousSnapshot,
			buildMountedCells: buildMountedCellsForEngine,
		});
		const nextSnapshot = result.snapshot;
		if (nextSnapshot.mountedBuild === null && previousMountedBuild) {
			rowSlotAllocator.reset();
		}
		commitComputation(result);

		if (result.measurementKind === "skipped") {
			return {
				kind: "skipped",
				reason: "unstable",
				updateKind: "skipped",
			};
		}

		const updateKind =
			nextSnapshot.mountedBuild === previousMountedBuild
				? "reused"
				: "recomputed";
		if (result.measurementKind === "bootstrapped") {
			return {
				kind: "bootstrapped",
				range: nextSnapshot.ranges.mounted,
				updateKind,
			};
		}

		hasStableVisibleRange = true;
		return {
			kind: "stable",
			range: nextSnapshot.ranges.mounted,
			updateKind,
		};
	}

	function recompute(params: { rowModel: TRowModel }): void {
		const previousSnapshot = latestSnapshot;
		if (!previousSnapshot) {
			return;
		}

		const result = recomputeVirtualListSnapshot({
			rowModel: params.rowModel,
			previous: previousSnapshot,
			buildMountedCells: buildMountedCellsForEngine,
		});
		if (result.snapshot.mountedBuild === null && previousSnapshot.mountedBuild) {
			rowSlotAllocator.reset();
		}
		commitComputation(result);
	}

	function setEmpty(params: { rowModel: TRowModel }): void {
		rowSlotAllocator.reset();
		commitComputation(
			createEmptyVirtualListComputation<TCell, TMountedCell, TMountedBuild>({
				rowModel: params.rowModel,
			}),
		);
	}

	$effect(() => () => {
		rowSlotAllocator.dispose();
	});

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
	let coverageScrollTopMin = Number.POSITIVE_INFINITY;
	let coverageScrollTopMax = Number.NEGATIVE_INFINITY;
	const scrollMeasurementRange: {
		-readonly [K in keyof ScrollMeasurementRange]: ScrollMeasurementRange[K];
	} = {
		minScrollTopBeforeMeasurement: 0,
		maxScrollTopBeforeMeasurement: 0,
	};
	const publishedCoverageBand: {
		-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
	} = {
		min: 0,
		max: 0,
	};
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
	let activeViewportObservation: VirtualListViewportObservation | null = null;
	let unstableMeasurementRetryCount = 0;
	let pendingScrollMeasurementTask: (() => void) | undefined;

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

	function setLastScrollWindow(coverageBand?: StableScrollTopBand): void {
		coverageScrollTopMin = coverageBand?.min ?? Number.POSITIVE_INFINITY;
		coverageScrollTopMax = coverageBand?.max ?? Number.NEGATIVE_INFINITY;
	}

	function resetLastScrollWindow(): void {
		setLastScrollWindow();
	}

	function resolvePublishedCoverageBand(
		mountedMeasurement: MountedScrollWindowMeasurement,
		rangedMeasurement: RangedScrollWindowMeasurement,
	): StableScrollTopBand | undefined {
		const mountedBand = mountedMeasurement.mountedCoverageScrollTopBand;
		const previewBand = rangedMeasurement.previewCoverageScrollTopBand;
		if (
			!mountedBand ||
			!previewBand ||
			mountedMeasurement.identity !== rangedMeasurement.identity ||
			mountedMeasurement.mounted.start !==
				rangedMeasurement.ranges.mounted.start ||
			mountedMeasurement.mounted.end !== rangedMeasurement.ranges.mounted.end ||
			rangedMeasurement.ranges.previewVisible.start <
				rangedMeasurement.ranges.mounted.start ||
			rangedMeasurement.ranges.previewVisible.end >
				rangedMeasurement.ranges.mounted.end
		) {
			return undefined;
		}

		publishedCoverageBand.min = Math.max(mountedBand.min, previewBand.min);
		publishedCoverageBand.max = Math.min(mountedBand.max, previewBand.max);
		return publishedCoverageBand.min < publishedCoverageBand.max
			? publishedCoverageBand
			: undefined;
	}

	function getScrollMeasurementRange(): ScrollMeasurementRange | null {
		if (!(coverageScrollTopMin < coverageScrollTopMax)) {
			return null;
		}

		scrollMeasurementRange.minScrollTopBeforeMeasurement = coverageScrollTopMin;
		scrollMeasurementRange.maxScrollTopBeforeMeasurement = coverageScrollTopMax;
		return scrollMeasurementRange;
	}

	function publishScrollMeasurementRange(): void {
		activeViewportObservation?.publishScrollMeasurementRange(
			getScrollMeasurementRange(),
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
			resetLastScrollWindow();
		}

		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualScroll.rangeMeasurementApplied");
		}

		const result = applyRangeMeasurement(nextMeasurement, context, resolvedRanges);
		if (process.env.NODE_ENV !== "production" && result.kind === "stable") {
			recordCCLDevMeasurement(
				result.updateKind === "reused"
					? "virtualScroll.rangeMeasurementReused"
					: "virtualScroll.rangeMeasurementChanged",
			);
		}

		if (result.kind !== "stable") {
			resetLastScrollWindow();
			return "unstable";
		}

		setLastScrollWindow(
			mountedMeasurement && rangedMeasurement
				? resolvePublishedCoverageBand(mountedMeasurement, rangedMeasurement)
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
			resetLastScrollWindow();
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
		const result = applyRangeMeasurement(
			{ ...effectiveMeasurement, isScrollActive: false },
			resolution.context,
			resolvedRanges,
		);
		if (result.kind !== "stable" || !resolution.isStable) {
			resetLastScrollWindow();
			return "unstable";
		}

		setLastScrollWindow(
			mountedMeasurement && rangedMeasurement
				? resolvePublishedCoverageBand(mountedMeasurement, rangedMeasurement)
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
		publishScrollMeasurementRange();
		return result;
	}

	function runLayoutMeasurement(): VirtualMeasurementResult {
		const rootEl = getRootEl();
		if (!rootEl) {
			return SKIPPED_NO_ROOT;
		}
		if (!getOptionalOwnerWindow(rootEl)) {
			return SKIPPED_NO_WINDOW;
		}

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

	function hasPendingLayoutMeasurement(): boolean {
		return (
			frameCoordinator.isScheduled(
				MEASUREMENT_LANE,
				LAYOUT_MEASUREMENT_TASK_KEY,
			) ||
			frameCoordinator.isScheduled(
				MEASUREMENT_LANE,
				UNSTABLE_MEASUREMENT_TASK_KEY,
			)
		);
	}

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

	function runScheduledScrollMeasurement(): void {
		const task = pendingScrollMeasurementTask ?? runScrollMeasurement;
		pendingScrollMeasurementTask = undefined;
		task();
	}

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

	function runUnstableMeasurementRetry(): void {
		unstableMeasurementRetryCount += 1;
		runLayoutMeasurement();
	}

	function scheduleUnstableMeasurementRetry(): void {
		if (
			!hasSchedulingWindow() ||
			frameCoordinator.isScheduled(
				MEASUREMENT_LANE,
				UNSTABLE_MEASUREMENT_TASK_KEY,
			) ||
			unstableMeasurementRetryCount >=
				CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES
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

	function scheduleScrollMeasurementAfterLayout(
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
	}

	const initialMeasurementLifecycle = createInitialMeasurementLifecycle({
		measurement,
		hasStableVisibleRange: () => hasStableVisibleRange,
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
			initialMeasurementLifecycle.cancel();
			cancelAllScheduledMeasurements();
			observation();
		};
	}

	return {
		measurement,
		getSnapshot() {
			void mountedBuildState;
			void totalHeightState;
			return latestSnapshot;
		},
		getMountedCells() {
			return mountedBuildState?.cells ?? [];
		},
		getMountedBuild() {
			return mountedBuildState;
		},
		getTotalHeight(fallback: number) {
			return totalHeightState ?? fallback;
		},
		recompute,
		setEmpty,
		hasPendingLayoutMeasurement,
		observeRoot,
		runLayoutMeasurement,
		runScrollMeasurement,
		flushProgrammaticScrollMeasurement,
		scheduleLayoutMeasurement,
		scheduleScrollMeasurement,
		resetScrollWindow: resetLastScrollWindow,
	};
}
