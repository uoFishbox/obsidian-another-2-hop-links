import { clampRange, sameRange, type RowRange } from "../rowRange";
import {
	computeVirtualRanges,
	type ComputeVirtualRangesResult,
} from "../virtualRanges";
import {
	type MountedVirtualCell,
	type VirtualListRevision,
	type VirtualRanges,
	type VirtualRowModel,
	type VirtualRowModelRevision,
} from "../types";
import {
	getMeasurementKindForMode,
	type MaterializedVirtualListMode,
	type VirtualListMeasurementKind,
} from "./VirtualListMode";
import {
	hasSameVirtualListRevisionDependency,
	type VirtualListRevisionDependency,
} from "./virtualListRevision";

export interface VirtualListMeasurement {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isStableMeasurement: boolean;
	hasStableVisibleRange: boolean;
	currentMountedRange: RowRange;
	isScrollActive?: boolean;
	/**
	 * Value-stable ranges published by the scroll-window resolver. They are
	 * retained by reference, so callers must not mutate them after passing
	 * them here.
	 */
	precomputedRanges?: VirtualRanges;
}

export interface VirtualVisibilityPolicy {
	bootstrapRows: number;
	mountedOverscanPx: number;
	previewOverscanPx?: number;
}

export interface MountedVirtualCellsBuild<TMountedCell extends MountedVirtualCell> {
	/**
	 * Builders may mutate this array while constructing the result. Treat it as
	 * immutable after returning the build to the engine.
	 */
	cells: TMountedCell[];
	/**
	 * Builders own this map while constructing the result. Treat it as
	 * immutable after returning the build to the engine.
	 */
	reusableCellsByKey: Map<string, TMountedCell>;
	mountedCellCount?: number;
	nextRenderSlotIndex: number;
}

export interface VirtualListSnapshot<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	rowModel: VirtualRowModel<TCell>;
	ranges: VirtualRanges;
	mountedBuild: TMountedBuild | null;
	totalHeight: number;
	mode: MaterializedVirtualListMode;
}

export interface VirtualListComputation<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>;
	measurementKind: VirtualListMeasurementKind;
}

export interface VirtualListInput<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	rowModel: VirtualRowModel<TCell>;
	measurement: VirtualListMeasurement;
	visibilityPolicy: VirtualVisibilityPolicy;
	previous?: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> | null;
	buildMountedCells(params: {
		rowModel: VirtualRowModel<TCell>;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
	}): TMountedBuild;
}

export interface VirtualListRecomputeInput<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	rowModel: VirtualRowModel<TCell>;
	previous: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>;
	buildMountedCells(params: {
		rowModel: VirtualRowModel<TCell>;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
	}): TMountedBuild;
}

const EMPTY_VIRTUAL_RANGES: VirtualRanges = {
	mounted: { start: 0, end: 0 },
	previewVisible: { start: 0, end: 0 },
};

/**
 * Mounted-cell reuse deliberately ignores measurement and preview policy.
 * Those inputs may change visible metadata or ranges without changing cell
 * bodies. Add a dependency here only when mounted-cell construction reads it.
 */
const MOUNTED_CELL_ROW_MODEL_REVISION_DEPENDENCY = {
	content: true,
	layout: true,
	keyResolver: true,
	pagination: true,
} as const satisfies VirtualListRevisionDependency;

const createSnapshot = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(params: {
	rowModel: VirtualRowModel<TCell>;
	ranges: VirtualRanges;
	mountedBuild: TMountedBuild;
	totalHeight: number;
	mode: MaterializedVirtualListMode;
}): VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> => {
	return {
		rowModel: params.rowModel,
		ranges: params.ranges,
		mountedBuild: params.mountedBuild,
		totalHeight: params.totalHeight,
		mode: params.mode,
	};
};

const cloneSnapshotWithOverrides = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
	overrides: {
		rowModel?: VirtualRowModel<TCell>;
		ranges?: VirtualRanges;
		totalHeight?: number;
		mode?: MaterializedVirtualListMode;
	},
): VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> => ({
	...snapshot,
	...overrides,
});

const didRangesChange = (
	previous: VirtualRanges | undefined,
	next: VirtualRanges,
): boolean =>
	!previous ||
	!sameRange(previous.mounted, next.mounted) ||
	!sameRange(previous.previewVisible, next.previewVisible);

const didMountedRangeChange = (
	previous: VirtualRanges | undefined,
	next: VirtualRanges,
): boolean => !previous || !sameRange(previous.mounted, next.mounted);

const clampVirtualRanges = (ranges: VirtualRanges, rowCount: number): VirtualRanges => {
	const mounted = clampRange(ranges.mounted, rowCount);
	const previewVisible = clampRange(ranges.previewVisible, rowCount);

	if (
		sameRange(ranges.mounted, mounted) &&
		sameRange(ranges.previewVisible, previewVisible)
	) {
		return ranges;
	}
	return {
		mounted,
		previewVisible,
	};
};

const sameVirtualListMode = (
	previous: MaterializedVirtualListMode,
	next: MaterializedVirtualListMode,
): boolean => {
	if (previous.kind !== next.kind) {
		return false;
	}

	switch (previous.kind) {
		case "bootstrapped":
		case "empty":
		case "skipped":
			if (next.kind !== previous.kind) {
				return false;
			}
			return previous.reason === next.reason;
		case "stable":
			if (next.kind !== "stable") {
				return false;
			}
			return previous.scrolling === next.scrolling;
	}
};

const withFastPathReuseSnapshot = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
	params: {
		rowModel: VirtualRowModel<TCell>;
		mode: MaterializedVirtualListMode;
	},
): VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> => {
	const rowModelReused = snapshot.rowModel === params.rowModel;
	if (
		rowModelReused &&
		snapshot.totalHeight === params.rowModel.totalHeight &&
		sameVirtualListMode(snapshot.mode, params.mode)
	) {
		return snapshot;
	}
	return cloneSnapshotWithOverrides(snapshot, {
		rowModel: params.rowModel,
		totalHeight: params.rowModel.totalHeight,
		mode: params.mode,
	});
};

export const createEmptyVirtualListComputation = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(params: {
	rowModel: VirtualRowModel<TCell>;
	mode: Extract<MaterializedVirtualListMode, { kind: "empty" }>;
}): VirtualListComputation<TCell, TMountedCell, TMountedBuild> => {
	return {
		snapshot: {
			rowModel: params.rowModel,
			ranges: EMPTY_VIRTUAL_RANGES,
			mountedBuild: null,
			totalHeight: params.rowModel.totalHeight,
			mode: params.mode,
		},
		measurementKind: getMeasurementKindForMode(params.mode),
	};
};

const isVirtualListRevision = (
	revision: VirtualRowModelRevision,
): revision is VirtualListRevision =>
	"content" in revision &&
	"layout" in revision &&
	"keyResolver" in revision &&
	"pagination" in revision &&
	"measurement" in revision &&
	"previewPolicy" in revision;

const hasSameMountedCellRowModelRevision = <TCell>(
	previous: VirtualRowModel<TCell>,
	next: VirtualRowModel<TCell>,
): boolean => {
	if (
		isVirtualListRevision(previous.revision) &&
		isVirtualListRevision(next.revision)
	) {
		return hasSameVirtualListRevisionDependency(
			previous.revision,
			next.revision,
			MOUNTED_CELL_ROW_MODEL_REVISION_DEPENDENCY,
		);
	}

	return Object.is(previous.revision, next.revision);
};

export function computeVirtualListSnapshot<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	input: VirtualListInput<TCell, TMountedCell, TMountedBuild>,
): VirtualListComputation<TCell, TMountedCell, TMountedBuild> {
	const rangesResult: ComputeVirtualRangesResult = computeVirtualRanges({
		rowModel: input.rowModel,
		scrollTop: input.measurement.scrollTop,
		viewportHeight: input.measurement.viewportHeight,
		sectionTop: input.measurement.sectionTop,
		isStableMeasurement: input.measurement.isStableMeasurement,
		hasStableVisibleRange: input.measurement.hasStableVisibleRange,
		currentMountedRange: input.measurement.currentMountedRange,
		bootstrapRows: input.visibilityPolicy.bootstrapRows,
		mountedOverscanPx: input.visibilityPolicy.mountedOverscanPx,
		previewOverscanPx: input.visibilityPolicy.previewOverscanPx ?? 0,
		isScrollActive: input.measurement.isScrollActive,
		precomputedRanges: input.measurement.precomputedRanges,
	});
	const previous = input.previous ?? null;
	const previousMountedBuild = previous?.mountedBuild ?? null;

	if (rangesResult.mode.kind === "empty") {
		return createEmptyVirtualListComputation({
			rowModel: input.rowModel,
			mode: rangesResult.mode,
		});
	}

	if (rangesResult.mode.kind === "skipped") {
		if (
			previous &&
			hasSameMountedCellRowModelRevision(previous.rowModel, input.rowModel) &&
			previous.totalHeight === input.rowModel.totalHeight
		) {
			const snapshot = withFastPathReuseSnapshot(previous, {
				rowModel: input.rowModel,
				mode: rangesResult.mode,
			});
			return {
				snapshot,
				measurementKind: getMeasurementKindForMode(rangesResult.mode),
			};
		}

		if (previous) {
			const recomputed = recomputeVirtualListSnapshot({
				rowModel: input.rowModel,
				previous,
				buildMountedCells: input.buildMountedCells,
			});
			return {
				snapshot: cloneSnapshotWithOverrides(recomputed.snapshot, {
					mode: rangesResult.mode,
				}),
				measurementKind: getMeasurementKindForMode(rangesResult.mode),
			};
		}

		return {
			snapshot: {
				rowModel: input.rowModel,
				ranges: EMPTY_VIRTUAL_RANGES,
				mountedBuild: previousMountedBuild,
				totalHeight: input.rowModel.totalHeight,
				mode: rangesResult.mode,
			},
			measurementKind: getMeasurementKindForMode(rangesResult.mode),
		};
	}

	if (!("ranges" in rangesResult)) {
		throw new Error("Virtual ranges are required for measured list modes.");
	}

	const rangeChanged = didRangesChange(previous?.ranges, rangesResult.ranges);
	const mountedRangeChanged = didMountedRangeChange(
		previous?.ranges,
		rangesResult.ranges,
	);
	if (
		previous &&
		hasSameMountedCellRowModelRevision(previous.rowModel, input.rowModel) &&
		!rangeChanged &&
		previous.totalHeight === input.rowModel.totalHeight &&
		previous.mountedBuild
	) {
		const snapshot = withFastPathReuseSnapshot(previous, {
			rowModel: input.rowModel,
			mode: rangesResult.mode,
		});
		return {
			snapshot,
			measurementKind: getMeasurementKindForMode(rangesResult.mode),
		};
	}

	if (
		previous &&
		hasSameMountedCellRowModelRevision(previous.rowModel, input.rowModel) &&
		!mountedRangeChanged &&
		previous.totalHeight === input.rowModel.totalHeight &&
		previous.mountedBuild
	) {
		return {
			snapshot: createSnapshot({
				rowModel: input.rowModel,
				ranges: rangesResult.ranges,
				mountedBuild: previous.mountedBuild,
				totalHeight: input.rowModel.totalHeight,
				mode: rangesResult.mode,
			}),
			measurementKind: getMeasurementKindForMode(rangesResult.mode),
		};
	}

	const mountedBuild = input.buildMountedCells({
		rowModel: input.rowModel,
		rowRange: rangesResult.ranges.mounted,
		ranges: rangesResult.ranges,
		previousBuild: previousMountedBuild ?? undefined,
	});

	return {
		snapshot: createSnapshot({
			rowModel: input.rowModel,
			ranges: rangesResult.ranges,
			mountedBuild,
			totalHeight: input.rowModel.totalHeight,
			mode: rangesResult.mode,
		}),
		measurementKind: getMeasurementKindForMode(rangesResult.mode),
	};
}

export function recomputeVirtualListSnapshot<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	input: VirtualListRecomputeInput<TCell, TMountedCell, TMountedBuild>,
): VirtualListComputation<TCell, TMountedCell, TMountedBuild> {
	if (input.rowModel.rowCount <= 0) {
		return createEmptyVirtualListComputation({
			rowModel: input.rowModel,
			mode: { kind: "empty", reason: "no-rows" },
		});
	}

	const previousMountedBuild = input.previous.mountedBuild;
	const ranges = clampVirtualRanges(input.previous.ranges, input.rowModel.rowCount);
	if (
		previousMountedBuild &&
		hasSameMountedCellRowModelRevision(input.previous.rowModel, input.rowModel) &&
		sameRange(input.previous.ranges.mounted, ranges.mounted)
	) {
		return {
			snapshot: createSnapshot({
				rowModel: input.rowModel,
				ranges,
				mountedBuild: previousMountedBuild,
				totalHeight: input.rowModel.totalHeight,
				mode: input.previous.mode,
			}),
			measurementKind: getMeasurementKindForMode(input.previous.mode),
		};
	}
	const mountedBuild = input.buildMountedCells({
		rowModel: input.rowModel,
		rowRange: ranges.mounted,
		ranges,
		previousBuild: previousMountedBuild ?? undefined,
	});

	return {
		snapshot: createSnapshot({
			rowModel: input.rowModel,
			ranges,
			mountedBuild,
			totalHeight: input.rowModel.totalHeight,
			mode: input.previous.mode,
		}),
		measurementKind: getMeasurementKindForMode(input.previous.mode),
	};
}
