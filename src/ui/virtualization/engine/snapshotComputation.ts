import { clampRange, sameRange, type RowRange } from "../model/rowRange";
import type { ComputeVirtualRangesResult } from "../model/ranges";
import {
	type MountedVirtualCell,
	type VirtualListRevision,
	type VirtualRanges,
	type VirtualRowModel,
} from "../model/types";

function sameRevisionToken(current: unknown, next: unknown): boolean {
	if (Object.is(current, next)) return true;
	if (!Array.isArray(current) || !Array.isArray(next)) return false;
	if (current.length !== next.length) return false;
	for (let index = 0; index < current.length; index += 1) {
		if (!Object.is(current[index], next[index])) return false;
	}
	return true;
}

export function hasSameVirtualListRevision(
	current: VirtualListRevision,
	next: VirtualListRevision,
): boolean {
	return (
		sameRevisionToken(current.content, next.content) &&
		sameRevisionToken(current.layout, next.layout)
	);
}

export interface MountedVirtualCellsBuild<TMountedCell extends MountedVirtualCell> {
	/**
	 * Builders may mutate this array while constructing the result. Treat it as
	 * immutable after returning the build to the engine.
	 */
	cells: TMountedCell[];
}

export interface VirtualListSnapshot<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	readonly rowModel: VirtualRowModel<TCell>;
	readonly ranges: VirtualRanges;
	readonly mountedBuild: TMountedBuild | null;
	readonly totalHeight: number;
}

export type VirtualListMeasurementKind = "stable" | "bootstrapped" | "skipped";

export interface VirtualListComputation<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	readonly snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>;
	readonly measurementKind: VirtualListMeasurementKind;
}

export interface VirtualListInput<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	rowModel: VirtualRowModel<TCell>;
	rangesResult: ComputeVirtualRangesResult;
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

const EMPTY_RANGE: RowRange = Object.freeze({ start: 0, end: 0 });
const EMPTY_VIRTUAL_RANGES: VirtualRanges = Object.freeze({
	mounted: EMPTY_RANGE,
	previewVisible: EMPTY_RANGE,
});

const freezeVirtualRanges = (ranges: VirtualRanges): VirtualRanges => {
	Object.freeze(ranges.mounted);
	Object.freeze(ranges.previewVisible);
	return Object.freeze(ranges);
};

const getMeasurementKind = (
	kind: ComputeVirtualRangesResult["kind"],
): VirtualListMeasurementKind => (kind === "empty" ? "stable" : kind);

const createSnapshot = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(params: {
	rowModel: VirtualRowModel<TCell>;
	ranges: VirtualRanges;
	mountedBuild: TMountedBuild;
	totalHeight: number;
}): VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> => {
	return Object.freeze({
		rowModel: params.rowModel,
		ranges: freezeVirtualRanges(params.ranges),
		mountedBuild: params.mountedBuild,
		totalHeight: params.totalHeight,
	});
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
	},
): VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> =>
	Object.freeze({
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

const withFastPathReuseSnapshot = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
	rowModel: VirtualRowModel<TCell>,
): VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> => {
	if (
		snapshot.rowModel === rowModel &&
		snapshot.totalHeight === rowModel.totalHeight
	) {
		return snapshot;
	}
	return cloneSnapshotWithOverrides(snapshot, {
		rowModel,
		totalHeight: rowModel.totalHeight,
	});
};

export const createEmptyVirtualListComputation = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(params: {
	rowModel: VirtualRowModel<TCell>;
}): VirtualListComputation<TCell, TMountedCell, TMountedBuild> => {
	return {
		snapshot: Object.freeze({
			rowModel: params.rowModel,
			ranges: EMPTY_VIRTUAL_RANGES,
			mountedBuild: null,
			totalHeight: params.rowModel.totalHeight,
		}),
		measurementKind: "stable",
	};
};

const hasSameMountedCellRowModelRevision = <TCell>(
	previous: VirtualRowModel<TCell>,
	next: VirtualRowModel<TCell>,
): boolean => hasSameVirtualListRevision(previous.revision, next.revision);

export function computeVirtualListSnapshot<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	input: VirtualListInput<TCell, TMountedCell, TMountedBuild>,
): VirtualListComputation<TCell, TMountedCell, TMountedBuild> {
	const rangesResult = input.rangesResult;
	const previous = input.previous ?? null;
	const previousMountedBuild = previous?.mountedBuild ?? null;

	if (rangesResult.kind === "empty") {
		return createEmptyVirtualListComputation({ rowModel: input.rowModel });
	}

	if (rangesResult.kind === "skipped") {
		if (
			previous &&
			hasSameMountedCellRowModelRevision(previous.rowModel, input.rowModel) &&
			previous.totalHeight === input.rowModel.totalHeight
		) {
			return {
				snapshot: withFastPathReuseSnapshot(previous, input.rowModel),
				measurementKind: "skipped",
			};
		}

		if (previous) {
			const recomputed = recomputeVirtualListSnapshot({
				rowModel: input.rowModel,
				previous,
				buildMountedCells: input.buildMountedCells,
			});
			return {
				snapshot: recomputed.snapshot,
				measurementKind: "skipped",
			};
		}

		return {
			snapshot: Object.freeze({
				rowModel: input.rowModel,
				ranges: EMPTY_VIRTUAL_RANGES,
				mountedBuild: previousMountedBuild,
				totalHeight: input.rowModel.totalHeight,
			}),
			measurementKind: "skipped",
		};
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
		return {
			snapshot: withFastPathReuseSnapshot(previous, input.rowModel),
			measurementKind: getMeasurementKind(rangesResult.kind),
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
			}),
			measurementKind: getMeasurementKind(rangesResult.kind),
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
		}),
		measurementKind: getMeasurementKind(rangesResult.kind),
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
		return createEmptyVirtualListComputation({ rowModel: input.rowModel });
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
			}),
			measurementKind: "stable",
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
		}),
		measurementKind: "stable",
	};
}
