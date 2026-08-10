import { CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES } from "../cardVirtualListPolicy";
import {
	createVirtualScrollWindowRangeResolver,
	type VirtualScrollWindowRangeRowModel,
} from "../core/scrollWindowMeasurement";
import type {
	MountedScrollWindowMeasurement,
	RangedScrollWindowMeasurement,
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
import { createVirtualScrollWindowMeasurementController } from "./virtualScrollWindowMeasurementController";

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
	transformMountedScrollWindowMeasurement?(
		resolved: MountedScrollWindowMeasurement,
		measurement: VirtualMeasurement,
		context: TContext,
	): MountedScrollWindowMeasurement;
	transformRangedScrollWindowMeasurement?(
		resolved: RangedScrollWindowMeasurement,
		measurement: VirtualMeasurement,
		context: TContext,
	): RangedScrollWindowMeasurement;
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
 * Composes the shared range, scroll-window, and DOM measurement controllers.
 * Layout resolution and range publication remain owned by the calling surface.
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
	transformMountedScrollWindowMeasurement,
	transformRangedScrollWindowMeasurement,
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

	function resolveMountedScrollWindowMeasurement(
		nextMeasurement: VirtualMeasurement,
		context: TContext,
	): MountedScrollWindowMeasurement {
		const resolved = rangeResolver.resolveMountedScrollWindowMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			context,
		);
		return (
			transformMountedScrollWindowMeasurement?.(
				resolved,
				nextMeasurement,
				context,
			) ?? resolved
		);
	}

	function resolveRangedScrollWindowMeasurement(
		nextMeasurement: VirtualMeasurement,
		context: TContext,
		precomputedMountedRange?: RowRange,
	): RangedScrollWindowMeasurement {
		const resolved = rangeResolver.resolveScrollWindowMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			context,
			precomputedMountedRange,
		);
		return (
			transformRangedScrollWindowMeasurement?.(
				resolved,
				nextMeasurement,
				context,
			) ?? resolved
		);
	}

	const scrollWindowController =
		createVirtualScrollWindowMeasurementController<TContext>({
			resolveMountedScrollWindowMeasurement,
			resolveScrollWindowMeasurement: resolveRangedScrollWindowMeasurement,
			applyRangeMeasurement,
			onStableMeasurement: notifyStableMeasurement,
		});

	function applyLayoutMeasurement(
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult {
		const rootEl = getRootEl();
		if (!rootEl || !nextMeasurement.sectionRect) {
			scrollWindowController.resetLastScrollWindow();
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
			scrollWindowController.resetLastScrollWindow();
			return "unstable";
		}

		scrollWindowController.primeLastScrollWindow(
			effectiveMeasurement,
			resolution.context,
		);
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
			: scrollWindowController.applyScrollMeasurement(
					nextMeasurement,
					getContext(),
				);
	}

	const measurementController = createVirtualMeasurementController({
		getRootEl,
		measurement,
		hasRenderableContent,
		onMeasurement: applyMeasurement,
		onObservedWidthChange,
		getScrollMeasurementRange: scrollWindowController.getScrollMeasurementRange,
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
		resetScrollWindow: scrollWindowController.resetLastScrollWindow,
		updateFromCachedMeasurement(metrics): void {
			measurementController.runScrollMeasurement(metrics);
		},
	};
}
