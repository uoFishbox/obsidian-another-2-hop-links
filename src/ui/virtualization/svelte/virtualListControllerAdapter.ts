import { CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES } from "../cardVirtualListPolicy";
import {
	createVirtualScrollWindowRangeResolver,
	type VirtualScrollWindowRangeRowModel,
} from "../core/scrollWindowMeasurement";

import {
	createMountedScrollWindow,
	updateMountedScrollWindow,
	type LastMountedScrollWindow,
	type MountedScrollWindowMeasurement,
	type RangedScrollWindowMeasurement,
	type ScrollMeasurementRange,
	type StableScrollTopBand,
} from "../core/scrollWindowGate";
import type { VirtualVisibilityPolicy } from "../core/virtualListEngine";
import type { MeasurementUpdateResult } from "../dom/virtualListMeasurementAdapter";
import type { VirtualListMeasurementStateHandle } from "../dom/virtualListMeasurementState";
import {
	createVirtualMeasurementController,
	type VirtualListStableMeasurementContext,
	type VirtualMeasurement,
	type VirtualMeasurementApplicationResult,
} from "../dom/virtualMeasurementController";
import type { RowRange } from "../rowRange";
import type { VirtualFrameCoordinator } from "../scheduling/frameCoordinator";
import type { VirtualRanges } from "../types";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

export interface VirtualListLayoutMeasurementResolution<TContext> {
	readonly context: TContext;
	readonly measurement: VirtualMeasurement;
	readonly isStable: boolean;
	readonly precomputeRanges?: boolean;
}

export interface CreateVirtualListControllerAdapterOptions<
	TRowModel extends VirtualScrollWindowRangeRowModel,
	TContext,
> {
	getRootEl(): HTMLElement | null;
	measurement: VirtualListMeasurementStateHandle;
	getContext(): TContext;
	hasRenderableContent(): boolean;
	resolveRowModel(context: TContext): TRowModel;
	resolveVisibilityPolicy(context: TContext): VirtualVisibilityPolicy;
	applyRangeMeasurement(
		measurement: VirtualMeasurement,
		context: TContext,
		precomputedRanges?: VirtualRanges,
	): MeasurementUpdateResult<RowRange>;
	resolveLayoutMeasurement(
		measurement: VirtualMeasurement & { readonly sectionRect: DOMRect },
		rootEl: HTMLElement,
	): VirtualListLayoutMeasurementResolution<TContext>;
	onStableMeasurement?(context: VirtualListStableMeasurementContext): void;
	onObservedWidthChange?(width: number): void;
	frameCoordinator?: VirtualFrameCoordinator;
}

type VirtualMeasurementController = ReturnType<
	typeof createVirtualMeasurementController
>;

export interface VirtualListControllerAdapter {
	hasPendingLayoutMeasurement: VirtualMeasurementController["hasPendingLayoutMeasurement"];
	observeRoot: VirtualMeasurementController["observeRoot"];
	runLayoutMeasurement: VirtualMeasurementController["runLayoutMeasurement"];
	runScrollMeasurement: VirtualMeasurementController["runScrollMeasurement"];
	scheduleLayoutMeasurement: VirtualMeasurementController["scheduleLayoutMeasurement"];
	scheduleScrollMeasurement: VirtualMeasurementController["scheduleScrollMeasurement"];
	resetScrollWindow(): void;
	updateFromCachedMeasurement(
		metrics?: Parameters<VirtualMeasurementController["runScrollMeasurement"]>[0],
	): void;
}

/**
 * Owns scroll-window orchestration between the DOM measurement lifecycle and
 * the allocation-conscious core range resolver. Layout resolution and range
 * publication remain owned by the calling surface.
 */
export function createVirtualListControllerAdapter<
	TRowModel extends VirtualScrollWindowRangeRowModel,
	TContext,
>({
	getRootEl,
	measurement,
	getContext,
	hasRenderableContent,
	resolveRowModel,
	resolveVisibilityPolicy,
	applyRangeMeasurement,
	resolveLayoutMeasurement,
	onStableMeasurement,
	onObservedWidthChange,
	frameCoordinator,
}: CreateVirtualListControllerAdapterOptions<
	TRowModel,
	TContext
>): VirtualListControllerAdapter {
	const stableMeasurementContext: VirtualListStableMeasurementContext = {
		scrollTop: 0,
		viewportHeight: 0,
		sectionTop: 0,
		isScrollActive: false,
		sharedScrollMetrics: undefined,
	};

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

	const rangeResolver = createVirtualScrollWindowRangeResolver<TRowModel, TContext>({
		resolveRowModel,
		resolveVisibilityPolicy,
		resolveStableMountedScrollTopBand: true,
	});
	let lastMountedScrollWindow: LastMountedScrollWindow | null = null;
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

	function resetLastScrollWindow(): void {
		lastMountedScrollWindow = null;
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
		if (
			!lastMountedScrollWindow ||
			!(
				lastMountedScrollWindow.coverageScrollTopMin <
				lastMountedScrollWindow.coverageScrollTopMax
			)
		) {
			return null;
		}

		scrollMeasurementRange.minScrollTopBeforeMeasurement =
			lastMountedScrollWindow.coverageScrollTopMin;
		scrollMeasurementRange.maxScrollTopBeforeMeasurement =
			lastMountedScrollWindow.coverageScrollTopMax;
		return scrollMeasurementRange;
	}

	function primeLastScrollWindow(
		nextMeasurement: VirtualMeasurement,
		context: TContext,
	): void {
		if (!nextMeasurement.isStableMeasurement) {
			resetLastScrollWindow();
			return;
		}

		const mountedMeasurement = resolveMountedScrollWindowMeasurement(
			nextMeasurement,
			context,
		);
		const rangedMeasurement = resolveRangedScrollWindowMeasurement(
			nextMeasurement,
			context,
			mountedMeasurement.mounted,
		);
		lastMountedScrollWindow = createMountedScrollWindow(
			resolvePublishedCoverageBand(mountedMeasurement, rangedMeasurement),
		);
	}

	function applyScrollMeasurement(
		nextMeasurement: VirtualMeasurement,
		context: TContext,
	): VirtualMeasurementApplicationResult {
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualScroll.applyScrollMeasurement");
		}

		let pendingMountedMeasurement: MountedScrollWindowMeasurement | null = null;
		let pendingRangedMeasurement: RangedScrollWindowMeasurement | null = null;
		let precomputedRanges: VirtualRanges | undefined;

		if (nextMeasurement.isStableMeasurement && nextMeasurement.isScrollActive) {
			const mountedMeasurement = resolveMountedScrollWindowMeasurement(
				nextMeasurement,
				context,
			);

			pendingMountedMeasurement = mountedMeasurement;
			pendingRangedMeasurement = resolveRangedScrollWindowMeasurement(
				nextMeasurement,
				context,
				mountedMeasurement.mounted,
			);
			precomputedRanges = pendingRangedMeasurement.ranges;
		} else {
			resetLastScrollWindow();
		}

		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualScroll.rangeMeasurementApplied");
		}

		const result = applyRangeMeasurement(
			nextMeasurement,
			context,
			precomputedRanges,
		);
		if (process.env.NODE_ENV !== "production" && result.kind === "stable") {
			recordCCLDevMeasurement(
				result.updateKind === "reused"
					? "virtualScroll.rangeMeasurementReused"
					: "virtualScroll.rangeMeasurementChanged",
			);
		}

		if (result.kind !== "stable") {
			if (result.kind === "skipped") {
				resetLastScrollWindow();
				return "unstable";
			}
			lastMountedScrollWindow = pendingMountedMeasurement
				? createMountedScrollWindow(
						pendingRangedMeasurement
							? resolvePublishedCoverageBand(
									pendingMountedMeasurement,
									pendingRangedMeasurement,
								)
							: undefined,
					)
				: null;
			return "unstable";
		}

		if (pendingMountedMeasurement) {
			lastMountedScrollWindow = updateMountedScrollWindow(
				lastMountedScrollWindow,
				pendingRangedMeasurement
					? resolvePublishedCoverageBand(
							pendingMountedMeasurement,
							pendingRangedMeasurement,
						)
					: undefined,
			);
		} else {
			resetLastScrollWindow();
		}
		if (!nextMeasurement.isScrollActive) {
			primeLastScrollWindow(nextMeasurement, context);
		}
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
		);
		const effectiveMeasurement = resolution.measurement;
		const precomputedRanges = resolution.precomputeRanges
			? resolveRangedScrollWindowMeasurement(
					effectiveMeasurement,
					resolution.context,
				).ranges
			: undefined;
		const result = applyRangeMeasurement(
			{ ...effectiveMeasurement, isScrollActive: false },
			resolution.context,
			precomputedRanges,
		);
		if (result.kind !== "stable" || !resolution.isStable) {
			resetLastScrollWindow();
			return "unstable";
		}

		primeLastScrollWindow(effectiveMeasurement, resolution.context);
		measurementController.scheduleScrollMeasurementAfterLayout(
			effectiveMeasurement,
		);
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

	const measurementController = createVirtualMeasurementController({
		getRootEl,
		measurement,
		hasRenderableContent,
		onMeasurement: applyMeasurement,
		onObservedWidthChange,
		getScrollMeasurementRange,
		enableBootstrapMeasurementSuppression: true,
		enableInitialStabilization: true,
		primeUnstableScrollStart: true,
		maxUnstableMeasurementRetries:
			CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES,
		frameCoordinator,
	});

	return {
		hasPendingLayoutMeasurement: measurementController.hasPendingLayoutMeasurement,
		observeRoot: measurementController.observeRoot,
		runLayoutMeasurement: measurementController.runLayoutMeasurement,
		runScrollMeasurement: measurementController.runScrollMeasurement,
		scheduleLayoutMeasurement: measurementController.scheduleLayoutMeasurement,
		scheduleScrollMeasurement: measurementController.scheduleScrollMeasurement,
		resetScrollWindow: resetLastScrollWindow,
		updateFromCachedMeasurement(metrics): void {
			measurementController.runScrollMeasurement(metrics);
		},
	};
}
