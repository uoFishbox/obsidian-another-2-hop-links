import { clampRange, sameRange, type RowRange } from "../model/ranges";
import type { ComputeVirtualRangesResult } from "../model/ranges";
import type { VirtualRanges, VirtualRowModel } from "../model/types";

export interface VirtualListSnapshot<TCell, TMountedBuild> {
	readonly rowModel: VirtualRowModel<TCell>;
	readonly ranges: VirtualRanges;
	readonly mountedBuild: TMountedBuild | null;
	readonly totalHeight: number;
}

export type VirtualListMeasurementKind = "stable" | "bootstrapped" | "skipped";

export interface VirtualListComputation<TCell, TMountedBuild> {
	readonly snapshot: VirtualListSnapshot<TCell, TMountedBuild>;
	readonly measurementKind: VirtualListMeasurementKind;
}

export interface VirtualListInput<TCell, TMountedBuild> {
	rowModel: VirtualRowModel<TCell>;
	rangesResult: ComputeVirtualRangesResult;
	previous?: VirtualListSnapshot<TCell, TMountedBuild> | null;
	buildMountedRows(params: {
		rowModel: VirtualRowModel<TCell>;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
	}): TMountedBuild;
}

export interface VirtualListRecomputeInput<TCell, TMountedBuild> {
	rowModel: VirtualRowModel<TCell>;
	previous: VirtualListSnapshot<TCell, TMountedBuild>;
	buildMountedRows(params: {
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

const createSnapshot = <TCell, TMountedBuild>(params: {
	rowModel: VirtualRowModel<TCell>;
	ranges: VirtualRanges;
	mountedBuild: TMountedBuild;
	totalHeight: number;
}): VirtualListSnapshot<TCell, TMountedBuild> => {
	return Object.freeze({
		rowModel: params.rowModel,
		ranges: freezeVirtualRanges(params.ranges),
		mountedBuild: params.mountedBuild,
		totalHeight: params.totalHeight,
	});
};

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

export const createEmptyVirtualListComputation = <TCell, TMountedBuild>(params: {
	rowModel: VirtualRowModel<TCell>;
}): VirtualListComputation<TCell, TMountedBuild> => {
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

export function computeVirtualListSnapshot<TCell, TMountedBuild>(
	input: VirtualListInput<TCell, TMountedBuild>,
): VirtualListComputation<TCell, TMountedBuild> {
	const rangesResult = input.rangesResult;
	const previous = input.previous ?? null;
	const previousMountedBuild = previous?.mountedBuild ?? null;

	if (rangesResult.kind === "empty") {
		return createEmptyVirtualListComputation({ rowModel: input.rowModel });
	}

	if (rangesResult.kind === "skipped") {
		if (
			previous &&
			previous.rowModel === input.rowModel &&
			previous.totalHeight === input.rowModel.totalHeight
		) {
			return {
				snapshot: previous,
				measurementKind: "skipped",
			};
		}

		if (previous) {
			const recomputed = recomputeVirtualListSnapshot({
				rowModel: input.rowModel,
				previous,
				buildMountedRows: input.buildMountedRows,
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

	if (
		previous &&
		previous.rowModel === input.rowModel &&
		previous.totalHeight === input.rowModel.totalHeight &&
		previous.mountedBuild
	) {
		const mountedRangeIsUnchanged = sameRange(
			previous.ranges.mounted,
			rangesResult.ranges.mounted,
		);
		if (mountedRangeIsUnchanged) {
			const previewRangeIsUnchanged = sameRange(
				previous.ranges.previewVisible,
				rangesResult.ranges.previewVisible,
			);
			if (previewRangeIsUnchanged) {
				return {
					snapshot: previous,
					measurementKind: getMeasurementKind(rangesResult.kind),
				};
			}

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
	}

	const mountedBuild = input.buildMountedRows({
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

export function recomputeVirtualListSnapshot<TCell, TMountedBuild>(
	input: VirtualListRecomputeInput<TCell, TMountedBuild>,
): VirtualListComputation<TCell, TMountedBuild> {
	if (input.rowModel.rowCount <= 0) {
		return createEmptyVirtualListComputation({ rowModel: input.rowModel });
	}

	const previousMountedBuild = input.previous.mountedBuild;
	const ranges = clampVirtualRanges(input.previous.ranges, input.rowModel.rowCount);
	if (
		previousMountedBuild &&
		input.previous.rowModel === input.rowModel &&
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
	const mountedBuild = input.buildMountedRows({
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
