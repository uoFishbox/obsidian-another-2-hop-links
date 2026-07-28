import { sameRange, type RowRange } from "../rowRange";
import {
	computeVirtualListSnapshotWithState,
	createEmptyVirtualListComputation,
	recomputeVirtualListSnapshotWithState,
	type MountedVirtualCellsBuild,
	type VirtualCellVisibilityMetadataPolicy,
	type VirtualListComputation,
	type VirtualListReconciliationState,
	type VirtualListSnapshot,
	type VirtualVisibilityPolicy,
} from "./virtualListEngine";
import type {
	EmptyReason,
	MaterializedVirtualListMode,
	VirtualListMode,
} from "./VirtualListMode";
import type { MountedVirtualCell, VirtualRanges, VirtualRowModel } from "../types";
import type { ResidentSlotResetReason } from "./residentSlotAllocator";

export interface ApplyVirtualListMeasurementParams<
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

export type VirtualListRuntimeState<
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

/** Publishes independently observable virtual-list state changes. */
export interface VirtualListCallbacks<TMountedBuild> {
	/** Runs only when the mounted build identity changes. */
	onMountedBuildChanged?(
		next: TMountedBuild | null,
		previous: TMountedBuild | null,
	): void;
	/** Runs only when the preview-visible row range changes. */
	onPreviewRangeChanged?(range: RowRange): void;
	/** Runs only when the semantic list mode changes. */
	onModeChanged?(mode: VirtualListMode): void;
}

export interface CreateVirtualListRuntimeOptions<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> extends VirtualListCallbacks<TMountedBuild> {
	buildMountedCells(params: {
		rowModel: TRowModel;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
		previousCells?: readonly TMountedCell[];
		previousCellsByKey?: ReadonlyMap<string, TMountedCell>;
	}): TMountedBuild;
	onSnapshotUpdated?: (
		snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
		reconciliationState: VirtualListReconciliationState<TMountedBuild>,
	) => void;
	onStableVisibleRange?: () => void;
	onStateChanged?: (
		state: VirtualListRuntimeState<TCell, TMountedCell, TMountedBuild>,
	) => void;
	visibilityMetadataPolicy?: VirtualCellVisibilityMetadataPolicy;
	/**
	 * Provide the previous mounted-cell key index to mounted-cell builders and
	 * engine-managed metadata reconciliation.
	 *
	 * @default true
	 */
	providePreviousCellsByKey?: boolean;
	trackMountedCellsForChange?: boolean;
	mountedRowsReconciler?: {
		reset(reason: ResidentSlotResetReason): void;
		dispose(): void;
	};
}

const hasSameRefs = <T>(current: readonly T[], next: readonly T[]): boolean => {
	if (current === next) {
		return true;
	}

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

export function createVirtualListRuntime<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	options: CreateVirtualListRuntimeOptions<
		TCell,
		TRowModel,
		TMountedCell,
		TMountedBuild
	>,
) {
	const initialReconciliationState: VirtualListReconciliationState<TMountedBuild> = {
		mountedBuild: null,
	};
	let runtimeState: VirtualListRuntimeState<TCell, TMountedCell, TMountedBuild> = {
		mode: { kind: "uninitialized" },
		snapshot: null,
		reconciliationState: initialReconciliationState,
		mountedCellsForChange: [],
	};

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

	const commitComputation = (
		result: VirtualListComputation<TCell, TMountedCell, TMountedBuild>,
	): void => {
		const previousState = runtimeState;
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
		const previousMountedBuild = previousState.reconciliationState.mountedBuild;
		const nextMountedBuild = nextReconciliationState.mountedBuild;
		if (previousMountedBuild !== nextMountedBuild) {
			options.onMountedBuildChanged?.(nextMountedBuild, previousMountedBuild);
		}
		const previousPreviewRange = previousState.snapshot?.ranges.previewVisible;
		const nextPreviewRange = nextSnapshot.ranges.previewVisible;
		if (
			!previousPreviewRange ||
			!sameRange(previousPreviewRange, nextPreviewRange)
		) {
			options.onPreviewRangeChanged?.(nextPreviewRange);
		}
		if (!hasSameMode(previousState.mode, nextSnapshot.mode)) {
			options.onModeChanged?.(nextSnapshot.mode);
		}
		options.onSnapshotUpdated?.(nextSnapshot, nextReconciliationState);
		options.onStateChanged?.(runtimeState);
	};

	const applyMeasurement = (
		params: ApplyVirtualListMeasurementParams<TCell, TRowModel>,
	): VirtualListMeasurementUpdateResult<RowRange> => {
		const previousSnapshot = runtimeState.snapshot;
		const previousReconciliationState = runtimeState.reconciliationState;
		const previousMountedBuild = previousReconciliationState.mountedBuild;
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
			providePreviousCellsByKey: options.providePreviousCellsByKey,
			buildMountedCells: options.buildMountedCells,
		});
		const nextSnapshot = result.snapshot;
		if (nextSnapshot.mode.kind === "empty" && previousMountedBuild) {
			options.mountedRowsReconciler?.reset("empty");
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
			result.reconciliationState.mountedBuild === previousMountedBuild
				? "reused"
				: "recomputed";

		if (result.measurementKind === "bootstrapped") {
			return {
				kind: "bootstrapped",
				range: nextSnapshot.ranges.mounted,
				updateKind,
			};
		}

		options.onStableVisibleRange?.();
		return {
			kind: "stable",
			range: nextSnapshot.ranges.mounted,
			updateKind,
		};
	};

	const recompute = (params: { rowModel: TRowModel }): void => {
		const previousSnapshot = runtimeState.snapshot;
		if (!previousSnapshot) {
			return;
		}

		const result = recomputeVirtualListSnapshotWithState({
			rowModel: params.rowModel,
			previous: previousSnapshot,
			previousState: runtimeState.reconciliationState,
			visibilityMetadataPolicy: options.visibilityMetadataPolicy,
			providePreviousCellsByKey: options.providePreviousCellsByKey,
			buildMountedCells: options.buildMountedCells,
		});
		if (
			result.snapshot.mode.kind === "empty" &&
			runtimeState.reconciliationState.mountedBuild
		) {
			options.mountedRowsReconciler?.reset("empty");
		}
		commitComputation(result);
	};

	const setEmpty = (params: { rowModel: TRowModel; reason?: EmptyReason }): void => {
		options.mountedRowsReconciler?.reset("empty");
		const result = createEmptyVirtualListComputation<
			TCell,
			TMountedCell,
			TMountedBuild
		>({
			rowModel: params.rowModel,
			previous: runtimeState.snapshot,
			mode: {
				kind: "empty",
				reason: params.reason ?? "no-renderable-content",
			},
		});
		commitComputation(result);
	};

	return {
		getState() {
			return runtimeState;
		},
		applyMeasurement,
		recompute,
		setEmpty,
		dispose() {
			options.mountedRowsReconciler?.dispose();
		},
	};
}

function hasSameMode(current: VirtualListMode, next: VirtualListMode): boolean {
	if (current.kind !== next.kind) return false;
	switch (current.kind) {
		case "uninitialized":
			return true;
		case "bootstrapped":
		case "empty":
		case "skipped":
			return next.kind === current.kind && current.reason === next.reason;
		case "stable":
			return next.kind === "stable" && current.scrolling === next.scrolling;
	}
}
