import type { RowRange } from "../rowRange";
import {
	computeVirtualListSnapshot,
	createEmptyVirtualListComputation,
	recomputeVirtualListSnapshot,
	type MountedVirtualCellsBuild,
	type VirtualListComputation,
	type VirtualListSnapshot,
	type VirtualVisibilityPolicy,
} from "../core/virtualListEngine";
import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
} from "../core/residentSlotAllocator";
import type { MountedVirtualCell, VirtualRanges, VirtualRowModel } from "../types";

export interface ApplyVirtualListMeasurementParams<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
> {
	rowModel: TRowModel;
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isStableMeasurement: boolean;
	/** Value-stable ranges; retained by reference and never mutated afterwards. */
	precomputedRanges?: VirtualRanges;
	visibilityPolicy: VirtualVisibilityPolicy;
}

export type VirtualListMeasurementUpdateKind = "skipped" | "reused" | "recomputed";

export type VirtualListMeasurementUpdateResult<TRange> =
	| { kind: "skipped"; reason: "unstable"; updateKind: "skipped" }
	| {
			kind: "bootstrapped";
			range: TRange;
			updateKind: Exclude<VirtualListMeasurementUpdateKind, "skipped">;
	  }
	| {
			kind: "stable";
			range: TRange;
			updateKind: Exclude<VirtualListMeasurementUpdateKind, "skipped">;
	  };

export interface UseVirtualListOptions<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	buildMountedCells(params: {
		rowModel: TRowModel;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
		/** Shared across builds; reuses physical row slots across range shifts. */
		rowSlotAllocator: ResidentRowSlotAllocator;
	}): TMountedBuild;
	onSnapshotUpdated?(
		snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
	): void;
}

export function useVirtualList<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(options: UseVirtualListOptions<TCell, TRowModel, TMountedCell, TMountedBuild>) {
	let latestSnapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> | null =
		null;
	let hasStableVisibleRange = false;
	let mountedBuildState = $state.raw<TMountedBuild | null>(null);
	let totalHeightState = $state<number | null>(null);

	// The list owns the resident row-slot allocator: every mounted build must
	// share it so physical row slots stay reusable across range shifts.
	const rowSlotAllocator = createResidentRowSlotAllocator();

	const buildMountedCells = (params: {
		rowModel: TRowModel;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
	}): TMountedBuild =>
		options.buildMountedCells({
			rowModel: params.rowModel,
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
		if (mountedBuildState !== nextSnapshot.mountedBuild) {
			mountedBuildState = nextSnapshot.mountedBuild;
		}
		if (totalHeightState !== nextSnapshot.totalHeight) {
			totalHeightState = nextSnapshot.totalHeight;
		}
		options.onSnapshotUpdated?.(nextSnapshot);
	};

	const applyMeasurement = (
		params: ApplyVirtualListMeasurementParams<TCell, TRowModel>,
	): VirtualListMeasurementUpdateResult<RowRange> => {
		const previousSnapshot = latestSnapshot;
		const previousMountedBuild = previousSnapshot?.mountedBuild ?? null;
		const result = computeVirtualListSnapshot({
			rowModel: params.rowModel,
			measurement: {
				scrollTop: params.scrollTop,
				viewportHeight: params.viewportHeight,
				sectionTop: params.sectionTop,
				isStableMeasurement: params.isStableMeasurement,
				hasStableVisibleRange,
				precomputedRanges: params.precomputedRanges,
				currentMountedRange: previousSnapshot?.ranges.mounted ?? {
					start: 0,
					end: 0,
				},
			},
			visibilityPolicy: params.visibilityPolicy,
			previous: previousSnapshot,
			buildMountedCells,
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
	};

	const recompute = (params: { rowModel: TRowModel }): void => {
		const previousSnapshot = latestSnapshot;
		if (!previousSnapshot) {
			return;
		}

		const result = recomputeVirtualListSnapshot({
			rowModel: params.rowModel,
			previous: previousSnapshot,
			buildMountedCells,
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

	$effect(() => () => {
		rowSlotAllocator.dispose();
	});

	return {
		getSnapshot() {
			void mountedBuildState;
			void totalHeightState;
			return latestSnapshot;
		},
		hasStableVisibleRange() {
			return hasStableVisibleRange;
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
		applyMeasurement,
		recompute,
		setEmpty,
	};
}
