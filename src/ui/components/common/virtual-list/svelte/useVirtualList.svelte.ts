import { untrack } from "svelte";
import type { MeasurementUpdateResult } from "../dom/virtualListMeasurementAdapter";
import type { RowRange } from "../rowRange";
import {
	computeVirtualListSnapshotWithState,
	createEmptyVirtualListComputation,
	recomputeVirtualListSnapshotWithState,
	type MountedVirtualCellsBuild,
	type VirtualCellVisibilityMetadataPolicy,
	type VirtualListReconciliationState,
	type VirtualListSnapshot,
	type VirtualVisibilityPolicy,
} from "../core/virtualListEngine";
import { publishVirtualListDebugSnapshot } from "../core/virtualListDebug";
import type {
	EmptyReason,
	MaterializedVirtualListMode,
	VirtualListMode,
} from "../core/VirtualListMode";
import type {
	MountedVirtualCell,
	VirtualRanges,
	VirtualRowModel,
} from "../types";

interface ApplyVirtualListMeasurementParams<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
> {
	rowModel: TRowModel;
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isStableMeasurement: boolean;
	hasStableVisibleRange: boolean;
	isScrollActive?: boolean;
	precomputedRanges?: VirtualRanges;
	visibilityPolicy: VirtualVisibilityPolicy;
}

type VirtualListRuntimeState<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> =
	| {
			mode: { kind: "uninitialized" };
			snapshot: null;
			reconciliationState: VirtualListReconciliationState<TMountedBuild>;
			mountedCellsForChange: readonly TMountedCell[];
	  }
	| {
			mode: MaterializedVirtualListMode;
			snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>;
			reconciliationState: VirtualListReconciliationState<TMountedBuild>;
			mountedCellsForChange: readonly TMountedCell[];
	  };

const hasSameRefs = <T>(current: readonly T[], next: readonly T[]): boolean => {
	if (current.length !== next.length) {
		return false;
	}

	for (let index = 0; index < current.length; index += 1) {
		if (current[index] !== next[index]) {
			return false;
		}
	}

	return true;
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
		ranges: import("../types").VirtualRanges;
		previousBuild?: TMountedBuild;
		previousCells?: readonly TMountedCell[];
		previousCellsByKey?: ReadonlyMap<string, TMountedCell>;
	}): TMountedBuild;
	onSnapshotUpdated?: (
		snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
		reconciliationState: VirtualListReconciliationState<TMountedBuild>,
	) => void;
	onStableVisibleRange?: () => void;
	debugName?: string;
	visibilityMetadataPolicy?: VirtualCellVisibilityMetadataPolicy;
	trackMountedCellsForChange?: boolean;
}

export function useVirtualList<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	options: UseVirtualListOptions<
		TCell,
		TRowModel,
		TMountedCell,
		TMountedBuild
	>,
) {
	const initialReconciliationState: VirtualListReconciliationState<TMountedBuild> =
		{ mountedBuild: null };
	let runtimeState = $state.raw<
		VirtualListRuntimeState<TCell, TMountedCell, TMountedBuild>
	>({
		mode: { kind: "uninitialized" },
		snapshot: null,
		reconciliationState: initialReconciliationState,
		mountedCellsForChange: [],
	});

	const updateMountedCellsForChange = (
		nextSnapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
		previousCellsForChange: readonly TMountedCell[],
	): readonly TMountedCell[] => {
		const nextCells = nextSnapshot.mountedCells;
		if (!hasSameRefs(previousCellsForChange, nextCells)) {
			return nextCells;
		}
		return previousCellsForChange;
	};

	const publishSnapshotUpdate = (
		nextSnapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
		nextReconciliationState: VirtualListReconciliationState<TMountedBuild>,
	): void => {
		options.onSnapshotUpdated?.(nextSnapshot, nextReconciliationState);
		publishVirtualListDebugSnapshot({
			name: options.debugName,
			snapshot: nextSnapshot,
		});
	};

	const commitComputation = (
		result: ReturnType<
			typeof computeVirtualListSnapshotWithState<
				TCell,
				TMountedCell,
				TMountedBuild
			>
		>,
	): void => {
		const previousState = untrack(() => runtimeState);
		const nextSnapshot = result.snapshot;
		const nextReconciliationState = result.reconciliationState;
		const snapshotChanged = previousState.snapshot !== nextSnapshot;
		const stateChanged =
			previousState.reconciliationState !== nextReconciliationState;

		if (!snapshotChanged && !stateChanged) {
			return;
		}

		runtimeState = {
			mode: nextSnapshot.mode,
			snapshot: nextSnapshot,
			reconciliationState: nextReconciliationState,
			mountedCellsForChange:
				snapshotChanged && options.trackMountedCellsForChange !== false
					? updateMountedCellsForChange(
							nextSnapshot,
							previousState.mountedCellsForChange,
						)
					: previousState.mountedCellsForChange,
		};
		publishSnapshotUpdate(nextSnapshot, nextReconciliationState);
	};

	const applyMeasurement = (
		params: ApplyVirtualListMeasurementParams<TCell, TRowModel>,
	): MeasurementUpdateResult<RowRange> => {
		const previousRuntimeState = untrack(() => runtimeState);
		const previousSnapshot = previousRuntimeState.snapshot;
		const previousReconciliationState =
			previousRuntimeState.reconciliationState;
		const result = computeVirtualListSnapshotWithState({
			rowModel: params.rowModel,
			measurement: {
				scrollTop: params.scrollTop,
				viewportHeight: params.viewportHeight,
				sectionTop: params.sectionTop,
				isStableMeasurement: params.isStableMeasurement,
				hasStableVisibleRange: params.hasStableVisibleRange,
				isScrollActive: params.isScrollActive,
				precomputedRanges: params.precomputedRanges,
				currentMountedRange: previousSnapshot?.ranges.mounted ?? {
					start: 0,
					end: 0,
				},
			},
			visibilityPolicy: params.visibilityPolicy,
			previous: previousSnapshot,
			previousState: previousReconciliationState,
			visibilityMetadataPolicy: options.visibilityMetadataPolicy,
			buildMountedCells: options.buildMountedCells,
		});
		const nextSnapshot = result.snapshot;
		commitComputation(result);

		if (result.measurementKind === "skipped") {
			return { kind: "skipped", reason: "unstable" };
		}

		if (result.measurementKind === "bootstrapped") {
			return {
				kind: "bootstrapped",
				range: nextSnapshot.ranges.mounted,
			};
		}

		options.onStableVisibleRange?.();
		return {
			kind: "stable",
			range: nextSnapshot.ranges.mounted,
		};
	};

	const recompute = (params: { rowModel: TRowModel }): void => {
		const previousRuntimeState = untrack(() => runtimeState);
		const previousSnapshot = previousRuntimeState.snapshot;
		if (!previousSnapshot) {
			return;
		}

		const result = recomputeVirtualListSnapshotWithState({
			rowModel: params.rowModel,
			previous: previousSnapshot,
			previousState: previousRuntimeState.reconciliationState,
			visibilityMetadataPolicy: options.visibilityMetadataPolicy,
			buildMountedCells: options.buildMountedCells,
		});
		commitComputation(result);
	};

	const setEmpty = (params: {
		rowModel: TRowModel;
		reason?: EmptyReason;
	}): void => {
		const previousRuntimeState = untrack(() => runtimeState);
		const result = createEmptyVirtualListComputation<
			TCell,
			TMountedCell,
			TMountedBuild
		>({
			rowModel: params.rowModel,
			previous: previousRuntimeState.snapshot,
			mode: {
				kind: "empty",
				reason: params.reason ?? "no-renderable-content",
			},
		});
		commitComputation(result);
	};

	return {
		getSnapshot() {
			return runtimeState.snapshot;
		},
		getMode(): VirtualListMode {
			return runtimeState.mode;
		},
		getMountedCells() {
			return runtimeState.mode.kind === "empty" ||
				runtimeState.mode.kind === "uninitialized"
				? []
				: (runtimeState.snapshot?.mountedCells ?? []);
		},
		getMountedCellsForChange() {
			return runtimeState.mountedCellsForChange;
		},
		getReconciliationState() {
			return runtimeState.reconciliationState;
		},
		getTotalHeight(fallback: number) {
			return runtimeState.snapshot?.totalHeight ?? fallback;
		},
		applyMeasurement,
		recompute,
		setEmpty,
	};
}
