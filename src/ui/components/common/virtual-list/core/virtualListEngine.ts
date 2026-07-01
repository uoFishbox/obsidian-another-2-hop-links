import { clampRange, sameRange, type RowRange } from "../rowRange";
import {
	computeVirtualRanges,
	type ComputeVirtualRangesResult,
} from "../virtualRanges";
import {
	renderSlotKey,
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
import type { VirtualizedItemVisibility } from "../../virtualizedItemVisibility";
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
	precomputedRanges?: VirtualRanges;
}

export interface VirtualVisibilityPolicy {
	bootstrapRows: number;
	mountedOverscanPx: number;
	previewOverscanPx?: number;
}

export type VirtualCellVisibilityMetadataPolicy =
	| { readonly type: "engine-managed" }
	| { readonly type: "caller-managed" };

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
	mountedCellsByKey?: ReadonlyMap<string, TMountedCell>;
	nextRenderSlotIndex: number;
}

export interface VirtualListReconciliationState<
	TMountedBuild extends MountedVirtualCellsBuild<MountedVirtualCell>,
> {
	mountedBuild: TMountedBuild | null;
}

export interface VirtualListSnapshot<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	rowModel: VirtualRowModel<TCell>;
	ranges: VirtualRanges;
	mountedCells: readonly TMountedCell[];
	mountedCellsByKey: ReadonlyMap<string, TMountedCell>;
	totalHeight: number;
	mode: MaterializedVirtualListMode;
}

export interface VirtualListComputation<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>;
	reconciliationState: VirtualListReconciliationState<TMountedBuild>;
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
	previousState?: VirtualListReconciliationState<TMountedBuild> | null;
	visibilityMetadataPolicy?: VirtualCellVisibilityMetadataPolicy;
	/**
	 * Provide the previous mounted-cell key index to mounted-cell builders and
	 * engine-managed metadata reconciliation.
	 *
	 * @default true
	 */
	providePreviousCellsByKey?: boolean;
	buildMountedCells(params: {
		rowModel: VirtualRowModel<TCell>;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
		previousCells?: readonly TMountedCell[];
		previousCellsByKey?: ReadonlyMap<string, TMountedCell>;
	}): TMountedBuild;
}

export interface VirtualListRecomputeInput<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> {
	rowModel: VirtualRowModel<TCell>;
	previous: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>;
	previousState?: VirtualListReconciliationState<TMountedBuild> | null;
	visibilityMetadataPolicy?: VirtualCellVisibilityMetadataPolicy;
	/**
	 * Provide the previous mounted-cell key index to mounted-cell builders and
	 * engine-managed metadata reconciliation.
	 *
	 * @default true
	 */
	providePreviousCellsByKey?: boolean;
	buildMountedCells(params: {
		rowModel: VirtualRowModel<TCell>;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
		previousCells?: readonly TMountedCell[];
		previousCellsByKey?: ReadonlyMap<string, TMountedCell>;
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

const DEFAULT_VISIBILITY_METADATA_POLICY: VirtualCellVisibilityMetadataPolicy = {
	type: "engine-managed",
};

const shouldApplyVisibilityMetadata = (
	policy: VirtualCellVisibilityMetadataPolicy = DEFAULT_VISIBILITY_METADATA_POLICY,
): boolean => policy.type === "engine-managed";

const shouldProvidePreviousCellsByKey = (
	providePreviousCellsByKey: boolean | undefined,
): boolean => providePreviousCellsByKey !== false;

const resolvePreviousCellsByKey = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	previous:
		| VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>
		| null
		| undefined,
	providePreviousCellsByKey: boolean | undefined,
): ReadonlyMap<string, TMountedCell> | undefined => {
	if (!shouldProvidePreviousCellsByKey(providePreviousCellsByKey)) {
		return undefined;
	}
	return previous?.mountedCellsByKey;
};

export const resolveVirtualizedItemVisibility = (
	rowIndex: number | undefined,
	ranges: VirtualRanges,
): VirtualizedItemVisibility => {
	if (
		rowIndex !== undefined &&
		rowIndex >= ranges.previewVisible.start &&
		rowIndex < ranges.previewVisible.end
	) {
		return "visible";
	}

	return "mounted";
};

const withVirtualCellMetadata = <TMountedCell extends MountedVirtualCell>(
	cell: TMountedCell,
	ranges: VirtualRanges,
	previousCellsByKey?: ReadonlyMap<string, TMountedCell>,
	options?: {
		visibilityMetadataPolicy?: VirtualCellVisibilityMetadataPolicy;
	},
): TMountedCell => {
	const nextRenderSlotKey = renderSlotKey(cell.renderSlotKey);
	const appliesVisibilityMetadata = shouldApplyVisibilityMetadata(
		options?.visibilityMetadataPolicy,
	);
	const nextVisibility = appliesVisibilityMetadata
		? resolveVirtualizedItemVisibility(cell.rowIndex, ranges)
		: undefined;
	const previous = previousCellsByKey?.get(cell.key);

	if (
		previous === cell &&
		previous.renderSlotIndex === cell.renderSlotIndex &&
		previous.renderSlotKey === nextRenderSlotKey &&
		(!appliesVisibilityMetadata || previous.visibility === nextVisibility)
	) {
		return previous;
	}

	if (
		cell.renderSlotKey === nextRenderSlotKey &&
		(!appliesVisibilityMetadata || cell.visibility === nextVisibility)
	) {
		return cell;
	}

	if (!appliesVisibilityMetadata) {
		return {
			...cell,
			renderSlotKey: nextRenderSlotKey,
		};
	}
	return {
		...cell,
		renderSlotKey: nextRenderSlotKey,
		visibility: nextVisibility,
	};
};

const applyVirtualCellMetadata = <TMountedCell extends MountedVirtualCell>(
	cells: readonly TMountedCell[],
	ranges: VirtualRanges,
	previousCellsByKey?: ReadonlyMap<string, TMountedCell>,
	options?: {
		visibilityMetadataPolicy?: VirtualCellVisibilityMetadataPolicy;
	},
): readonly TMountedCell[] => {
	let next: TMountedCell[] | null = null;

	for (let i = 0; i < cells.length; i += 1) {
		const cell = cells[i];
		const resolved = withVirtualCellMetadata(
			cell,
			ranges,
			previousCellsByKey,
			options,
		);

		if (resolved !== cell && next === null) {
			next = cells.slice(0, i);
		}

		if (next) {
			next.push(resolved);
		}
	}

	return next ?? cells;
};

const hasSameRefs = <T>(
	previous: readonly T[] | undefined,
	next: readonly T[],
): boolean => {
	if (!previous || previous.length !== next.length) {
		return false;
	}

	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) {
			return false;
		}
	}

	return true;
};

const createCallerManagedSnapshot = <
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
	let mountedCells: readonly TMountedCell[] | undefined;
	let mountedCellsByKey: ReadonlyMap<string, TMountedCell> | undefined;
	return {
		rowModel: params.rowModel,
		ranges: params.ranges,
		get mountedCells() {
			mountedCells ??= params.mountedBuild.cells;
			return mountedCells;
		},
		get mountedCellsByKey() {
			if (!mountedCellsByKey) {
				mountedCellsByKey =
					params.mountedBuild.mountedCellsByKey ??
					params.mountedBuild.reusableCellsByKey;
			}
			return mountedCellsByKey;
		},
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
): VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> => {
	const descriptors = Object.getOwnPropertyDescriptors(snapshot);
	if (overrides.rowModel !== undefined) {
		descriptors.rowModel = {
			value: overrides.rowModel,
			enumerable: true,
			configurable: true,
			writable: true,
		};
	}
	if (overrides.ranges !== undefined) {
		descriptors.ranges = {
			value: overrides.ranges,
			enumerable: true,
			configurable: true,
			writable: true,
		};
	}
	if (overrides.totalHeight !== undefined) {
		descriptors.totalHeight = {
			value: overrides.totalHeight,
			enumerable: true,
			configurable: true,
			writable: true,
		};
	}
	if (overrides.mode !== undefined) {
		descriptors.mode = {
			value: overrides.mode,
			enumerable: true,
			configurable: true,
			writable: true,
		};
	}
	return Object.defineProperties({}, descriptors) as VirtualListSnapshot<
		TCell,
		TMountedCell,
		TMountedBuild
	>;
};

const createCallerManagedReuseSnapshot = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(params: {
	rowModel: VirtualRowModel<TCell>;
	ranges: VirtualRanges;
	mountedBuild: TMountedBuild;
	totalHeight: number;
	mode: MaterializedVirtualListMode;
}): VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> =>
	createCallerManagedSnapshot({
		rowModel: params.rowModel,
		ranges: params.ranges,
		mountedBuild: params.mountedBuild,
		totalHeight: params.totalHeight,
		mode: params.mode,
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

const didPreviewVisibleRangeChange = (
	previous: VirtualRanges | undefined,
	next: VirtualRanges,
): boolean => !previous || !sameRange(previous.previewVisible, next.previewVisible);

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

const indexMountedCells = <TMountedCell extends MountedVirtualCell>(
	mountedCells: readonly TMountedCell[],
): {
	mountedCellsByKey: ReadonlyMap<string, TMountedCell>;
} => {
	const mountedCellsByKey = new Map<string, TMountedCell>();

	for (const cell of mountedCells) {
		mountedCellsByKey.set(cell.key, cell);
	}
	return {
		mountedCellsByKey,
	};
};

export const createEmptyVirtualListComputation = <
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(params: {
	rowModel: VirtualRowModel<TCell>;
	previous:
		| VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>
		| null
		| undefined;
	mode: Extract<MaterializedVirtualListMode, { kind: "empty" }>;
}): VirtualListComputation<TCell, TMountedCell, TMountedBuild> => {
	const mountedCells: readonly TMountedCell[] = [];
	return {
		snapshot: {
			rowModel: params.rowModel,
			ranges: EMPTY_VIRTUAL_RANGES,
			mountedCells,
			mountedCellsByKey: new Map(),
			totalHeight: params.rowModel.totalHeight,
			mode: params.mode,
		},
		reconciliationState: {
			mountedBuild: null,
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

export function computeVirtualListSnapshotWithState<
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
	const previousMountedBuild = input.previousState?.mountedBuild ?? null;

	if (rangesResult.mode.kind === "empty") {
		return createEmptyVirtualListComputation({
			rowModel: input.rowModel,
			previous,
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
				reconciliationState: input.previousState ?? {
					mountedBuild: previousMountedBuild,
				},
				measurementKind: getMeasurementKindForMode(rangesResult.mode),
			};
		}

		if (previous) {
			const recomputed = recomputeVirtualListSnapshotWithState({
				rowModel: input.rowModel,
				previous,
				previousState: input.previousState,
				visibilityMetadataPolicy: input.visibilityMetadataPolicy,
				providePreviousCellsByKey: input.providePreviousCellsByKey,
				buildMountedCells: input.buildMountedCells,
			});
			return {
				snapshot: cloneSnapshotWithOverrides(recomputed.snapshot, {
					mode: rangesResult.mode,
				}),
				reconciliationState: recomputed.reconciliationState,
				measurementKind: getMeasurementKindForMode(rangesResult.mode),
			};
		}

		return {
			snapshot: {
				rowModel: input.rowModel,
				ranges: EMPTY_VIRTUAL_RANGES,
				mountedCells: [],
				mountedCellsByKey: new Map(),
				totalHeight: input.rowModel.totalHeight,
				mode: rangesResult.mode,
			},
			reconciliationState: {
				mountedBuild: previousMountedBuild,
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
	const previewVisibleRangeChanged = didPreviewVisibleRangeChange(
		previous?.ranges,
		rangesResult.ranges,
	);
	const callerManagesVisibilityMetadata = !shouldApplyVisibilityMetadata(
		input.visibilityMetadataPolicy,
	);
	if (
		previous &&
		hasSameMountedCellRowModelRevision(previous.rowModel, input.rowModel) &&
		!rangeChanged &&
		previous.totalHeight === input.rowModel.totalHeight &&
		input.previousState?.mountedBuild
	) {
		const snapshot = withFastPathReuseSnapshot(previous, {
			rowModel: input.rowModel,
			mode: rangesResult.mode,
		});
		return {
			snapshot,
			reconciliationState: input.previousState,
			measurementKind: getMeasurementKindForMode(rangesResult.mode),
		};
	}

	if (
		previous &&
		callerManagesVisibilityMetadata &&
		input.measurement.isScrollActive &&
		previous.rowModel === input.rowModel &&
		!mountedRangeChanged &&
		previewVisibleRangeChanged &&
		previous.totalHeight === input.rowModel.totalHeight &&
		input.previousState?.mountedBuild
	) {
		return {
			snapshot: createCallerManagedReuseSnapshot({
				rowModel: input.rowModel,
				ranges: rangesResult.ranges,
				mountedBuild: input.previousState.mountedBuild,
				totalHeight: input.rowModel.totalHeight,
				mode: rangesResult.mode,
			}),
			reconciliationState: input.previousState,
			measurementKind: getMeasurementKindForMode(rangesResult.mode),
		};
	}

	if (
		previous &&
		callerManagesVisibilityMetadata &&
		hasSameMountedCellRowModelRevision(previous.rowModel, input.rowModel) &&
		!mountedRangeChanged &&
		previous.totalHeight === input.rowModel.totalHeight &&
		input.previousState?.mountedBuild
	) {
		return {
			snapshot: createCallerManagedReuseSnapshot({
				rowModel: input.rowModel,
				ranges: rangesResult.ranges,
				mountedBuild: input.previousState.mountedBuild,
				totalHeight: input.rowModel.totalHeight,
				mode: rangesResult.mode,
			}),
			reconciliationState: input.previousState,
			measurementKind: getMeasurementKindForMode(rangesResult.mode),
		};
	}

	const previousCellsByKey = resolvePreviousCellsByKey(
		previous,
		input.providePreviousCellsByKey,
	);
	const mountedBuild = input.buildMountedCells({
		rowModel: input.rowModel,
		rowRange: rangesResult.ranges.mounted,
		ranges: rangesResult.ranges,
		previousBuild: previousMountedBuild ?? undefined,
		previousCells: callerManagesVisibilityMetadata
			? undefined
			: previous?.mountedCells,
		previousCellsByKey,
	});
	if (callerManagesVisibilityMetadata) {
		return {
			snapshot: createCallerManagedSnapshot({
				rowModel: input.rowModel,
				ranges: rangesResult.ranges,
				mountedBuild,
				totalHeight: input.rowModel.totalHeight,
				mode: rangesResult.mode,
			}),
			reconciliationState: {
				mountedBuild,
			},
			measurementKind: getMeasurementKindForMode(rangesResult.mode),
		};
	}
	const mountedCells = applyVirtualCellMetadata(
		mountedBuild.cells,
		rangesResult.ranges,
		previousCellsByKey,
		{
			visibilityMetadataPolicy: input.visibilityMetadataPolicy,
		},
	);
	if (
		previous &&
		hasSameMountedCellRowModelRevision(previous.rowModel, input.rowModel) &&
		!rangeChanged &&
		previous.totalHeight === input.rowModel.totalHeight &&
		hasSameRefs(previous.mountedCells, mountedCells)
	) {
		const snapshot = withFastPathReuseSnapshot(previous, {
			rowModel: input.rowModel,
			mode: rangesResult.mode,
		});
		return {
			snapshot,
			reconciliationState:
				mountedBuild === previousMountedBuild && input.previousState
					? input.previousState
					: { mountedBuild },
			measurementKind: getMeasurementKindForMode(rangesResult.mode),
		};
	}

	const { mountedCellsByKey } = indexMountedCells(mountedCells);

	return {
		snapshot: {
			rowModel: input.rowModel,
			ranges: rangesResult.ranges,
			mountedCells,
			mountedCellsByKey,
			totalHeight: input.rowModel.totalHeight,
			mode: rangesResult.mode,
		},
		reconciliationState: {
			mountedBuild,
		},
		measurementKind: getMeasurementKindForMode(rangesResult.mode),
	};
}

export function recomputeVirtualListSnapshotWithState<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	input: VirtualListRecomputeInput<TCell, TMountedCell, TMountedBuild>,
): VirtualListComputation<TCell, TMountedCell, TMountedBuild> {
	if (input.rowModel.rowCount <= 0) {
		return createEmptyVirtualListComputation({
			rowModel: input.rowModel,
			previous: input.previous,
			mode: { kind: "empty", reason: "no-rows" },
		});
	}

	const previousMountedBuild = input.previousState?.mountedBuild ?? null;
	const ranges = clampVirtualRanges(input.previous.ranges, input.rowModel.rowCount);
	const rangeChanged = didRangesChange(input.previous.ranges, ranges);
	const callerManagesVisibilityMetadata = !shouldApplyVisibilityMetadata(
		input.visibilityMetadataPolicy,
	);
	const previousCellsByKey = resolvePreviousCellsByKey(
		input.previous,
		input.providePreviousCellsByKey,
	);
	const mountedBuild = input.buildMountedCells({
		rowModel: input.rowModel,
		rowRange: ranges.mounted,
		ranges,
		previousBuild: previousMountedBuild ?? undefined,
		previousCells: callerManagesVisibilityMetadata
			? undefined
			: input.previous.mountedCells,
		previousCellsByKey,
	});
	if (callerManagesVisibilityMetadata) {
		return {
			snapshot: createCallerManagedSnapshot({
				rowModel: input.rowModel,
				ranges,
				mountedBuild,
				totalHeight: input.rowModel.totalHeight,
				mode: input.previous.mode,
			}),
			reconciliationState: {
				mountedBuild,
			},
			measurementKind: getMeasurementKindForMode(input.previous.mode),
		};
	}
	const mountedCells = applyVirtualCellMetadata(
		mountedBuild.cells,
		ranges,
		previousCellsByKey,
		{
			visibilityMetadataPolicy: input.visibilityMetadataPolicy,
		},
	);
	if (
		(input.previous.rowModel === input.rowModel ||
			hasSameMountedCellRowModelRevision(
				input.previous.rowModel,
				input.rowModel,
			)) &&
		input.previous.totalHeight === input.rowModel.totalHeight &&
		!rangeChanged &&
		mountedBuild === previousMountedBuild &&
		hasSameRefs(input.previous.mountedCells, mountedCells)
	) {
		const snapshot = withFastPathReuseSnapshot(input.previous, {
			rowModel: input.rowModel,
			mode: input.previous.mode,
		});
		return {
			snapshot,
			reconciliationState: input.previousState ?? {
				mountedBuild,
			},
			measurementKind: getMeasurementKindForMode(input.previous.mode),
		};
	}

	const { mountedCellsByKey } = indexMountedCells(mountedCells);

	return {
		snapshot: {
			rowModel: input.rowModel,
			ranges,
			mountedCells,
			mountedCellsByKey,
			totalHeight: input.rowModel.totalHeight,
			mode: input.previous.mode,
		},
		reconciliationState: {
			mountedBuild,
		},
		measurementKind: getMeasurementKindForMode(input.previous.mode),
	};
}
