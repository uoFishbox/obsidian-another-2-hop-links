import type { VirtualListSnapshot } from "../engine/snapshotComputation";
import type { VirtualScrollWindowRangeRowModel } from "../engine/scrollWindowResolver";
import type { ResidentRowSlotAllocator } from "../engine/mountedGridRows";
import type { RowRange } from "../model/ranges";
import type { VirtualRanges, VirtualRowModel } from "../model/types";
import type { VirtualVisibilityPolicy } from "../model/ranges";
import type {
	VirtualListStableMeasurementContext,
	VirtualMeasurement,
	VirtualMeasurementApplicationResult,
	VirtualMeasurementResult,
	VirtualScrollMeasurementReason,
} from "./measurementLifecycle";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { createVirtualizerEngine } from "../engine/virtualizer";
import {
	createVirtualMeasurementRuntime,
	type VirtualListLayoutMeasurementResolution,
	type VirtualizerMeasurementState,
} from "./virtualMeasurementRuntime";

export type {
	VirtualListStableMeasurementContext,
	VirtualMeasurement,
	VirtualMeasurementApplicationResult,
	VirtualMeasurementResult,
	VirtualScrollMeasurementReason,
} from "./measurementLifecycle";
export type {
	VirtualListLayoutMeasurementResolution,
	VirtualizerMeasurementState,
} from "./virtualMeasurementRuntime";

export interface UseVirtualizerOptions<
	TCell,
	TRowModel extends VirtualRowModel<TCell> & VirtualScrollWindowRangeRowModel,
	TContext,
	TMountedBuild,
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
	onSnapshotUpdated?(snapshot: VirtualListSnapshot<TCell, TMountedBuild>): void;
	resolveLayoutMeasurement(
		measurement: VirtualMeasurement & { readonly sectionRect: DOMRect },
		rootEl: HTMLElement,
		runtimeMeasurement: VirtualizerMeasurementState,
	): VirtualListLayoutMeasurementResolution<TContext>;
	onStableMeasurement?(context: VirtualListStableMeasurementContext): void;
	onObservedWidthChange?(width: number): void;
	/** Maximum retries while layout metrics are temporarily unstable. */
	unstableMeasurementRetryLimit?: number;
	frameCoordinator: VirtualFrameCoordinator;
}

const DEFAULT_UNSTABLE_MEASUREMENT_RETRY_LIMIT = 6;

/** Connects Svelte state to the DOM measurement runtime and virtualizer engine. */
export function useVirtualizer<
	TCell,
	TRowModel extends VirtualRowModel<TCell> & VirtualScrollWindowRangeRowModel,
	TContext,
	TMountedBuild,
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
	unstableMeasurementRetryLimit = DEFAULT_UNSTABLE_MEASUREMENT_RETRY_LIMIT,
	frameCoordinator,
}: UseVirtualizerOptions<TCell, TRowModel, TContext, TMountedBuild>) {
	const measurement = $state<VirtualizerMeasurementState>({
		sectionTop: 0,
		viewportHeight: 0,
		hasStableScrollMetrics: false,
		measuredWidth: null,
		scrollContainerEl: null,
	});
	let mountedBuildState = $state.raw<TMountedBuild | null>(null);
	let totalHeightState = $state<number | null>(null);
	const engine = createVirtualizerEngine<TCell, TRowModel, TContext, TMountedBuild>({
		resolveRowModel,
		resolveVisibilityPolicy,
		buildMountedCells,
		onSnapshotUpdated: (nextSnapshot) => {
			if (mountedBuildState !== nextSnapshot.mountedBuild) {
				mountedBuildState = nextSnapshot.mountedBuild;
			}
			if (totalHeightState !== nextSnapshot.totalHeight) {
				totalHeightState = nextSnapshot.totalHeight;
			}
			onSnapshotUpdated?.(nextSnapshot);
		},
	});
	const { recompute, setEmpty } = engine;

	const runtime = createVirtualMeasurementRuntime({
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
	});

	$effect(() => () => {
		engine.dispose();
	});

	return {
		measurement,
		getSnapshot() {
			void mountedBuildState;
			void totalHeightState;
			return engine.getSnapshot();
		},
		getMountedBuild() {
			return mountedBuildState;
		},
		getTotalHeight(fallback: number) {
			return totalHeightState ?? fallback;
		},
		recompute,
		setEmpty,
		hasPendingLayoutMeasurement: runtime.hasPendingLayoutMeasurement,
		observeRoot: runtime.observeRoot,
		runLayoutMeasurement: runtime.runLayoutMeasurement,
		runScrollMeasurement: runtime.runScrollMeasurement,
		flushProgrammaticScrollMeasurement: runtime.flushProgrammaticScrollMeasurement,
		suppressNextNativeScroll: runtime.suppressNextNativeScroll,
		scheduleLayoutMeasurement: runtime.scheduleLayoutMeasurement,
		scheduleScrollMeasurement: runtime.scheduleScrollMeasurement,
		resetScrollWindow: runtime.resetScrollWindow,
	};
}
