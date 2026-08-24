import {
	computeVirtualListSnapshot,
	createEmptyVirtualListComputation,
	recomputeVirtualListSnapshot,
	type MountedVirtualCellsBuild,
	type VirtualListComputation,
	type VirtualListSnapshot,
} from "./snapshotComputation";
import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
} from "./mountedGridRows";
import type { MeasurementUpdateResult } from "../viewport/measurement";
import type { VirtualMeasurement } from "../runtime/measurementLifecycle";
import type { RowRange } from "../model/ranges";
import type {
	MountedVirtualCell,
	VirtualRanges,
	VirtualRowModel,
} from "../model/types";
import { computeVirtualRanges, type VirtualVisibilityPolicy } from "../model/ranges";

export interface VirtualizerEngine<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TContext,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	applyRangeMeasurement(
		measurement: VirtualMeasurement,
		context: TContext,
		precomputedRanges?: VirtualRanges,
	): MeasurementUpdateResult<RowRange>;
	recompute(params: { rowModel: TRowModel }): void;
	setEmpty(params: { rowModel: TRowModel }): void;
	getSnapshot(): VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> | null;
	hasStableVisibleRange(): boolean;
	dispose(): void;
}

export interface CreateVirtualizerEngineOptions<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TContext,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
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
}

/**
 * Owns snapshot state, resident physical row slots, range application, and
 * recomputation. It has no DOM or Svelte lifecycle responsibilities.
 */
export function createVirtualizerEngine<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TContext,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>({
	resolveRowModel,
	resolveVisibilityPolicy,
	buildMountedCells,
	onSnapshotUpdated,
}: CreateVirtualizerEngineOptions<
	TCell,
	TRowModel,
	TContext,
	TMountedCell,
	TMountedBuild
>): VirtualizerEngine<TCell, TRowModel, TContext, TMountedCell, TMountedBuild> {
	let latestSnapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> | null =
		null;
	let stableVisibleRange = false;
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

	const commitComputation = (
		result: VirtualListComputation<TCell, TMountedCell, TMountedBuild>,
	): void => {
		const nextSnapshot = result.snapshot;
		if (latestSnapshot === nextSnapshot) {
			return;
		}

		latestSnapshot = nextSnapshot;
		onSnapshotUpdated?.(nextSnapshot);
	};

	const applyRangeMeasurement = (
		nextMeasurement: VirtualMeasurement,
		context: TContext,
		precomputedRanges?: VirtualRanges,
	): MeasurementUpdateResult<RowRange> => {
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
			hasStableVisibleRange: stableVisibleRange,
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

		stableVisibleRange = true;
		return {
			kind: "stable",
			range: nextSnapshot.ranges.mounted,
			updateKind,
		};
	};

	const recompute = (params: { rowModel: TRowModel }): void => {
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
	};

	const setEmpty = (params: { rowModel: TRowModel }): void => {
		rowSlotAllocator.reset();
		commitComputation(
			createEmptyVirtualListComputation<TCell, TMountedCell, TMountedBuild>({
				rowModel: params.rowModel,
			}),
		);
	};

	return {
		applyRangeMeasurement,
		recompute,
		setEmpty,
		getSnapshot: () => latestSnapshot,
		hasStableVisibleRange: () => stableVisibleRange,
		dispose: () => rowSlotAllocator.dispose(),
	};
}
