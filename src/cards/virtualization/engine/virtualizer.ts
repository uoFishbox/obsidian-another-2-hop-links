import {
	clampRange,
	computeVirtualRanges,
	sameRange,
	type ComputeVirtualRangesResult,
	type RowRange,
	type VirtualVisibilityPolicy,
} from "../model/ranges";
import type { VirtualRanges, VirtualRowModel } from "../model/types";
import type { VirtualMeasurement } from "../runtime/measurementLifecycle";
import type { MeasurementUpdateResult } from "../viewport/measurement";
import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
} from "./mountedGridRows";

export interface VirtualListSnapshot<TCell, TMountedBuild> {
	readonly rowModel: VirtualRowModel<TCell>;
	readonly ranges: VirtualRanges;
	readonly mountedBuild: TMountedBuild | null;
	readonly totalHeight: number;
}

export interface VirtualizerEngine<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedBuild,
> {
	applyRangeMeasurement(
		measurement: VirtualMeasurement,
		rowModel: TRowModel,
		visibilityPolicy: VirtualVisibilityPolicy,
		precomputedRanges?: VirtualRanges,
	): MeasurementUpdateResult<RowRange>;
	recompute(params: { rowModel: TRowModel }): void;
	setEmpty(params: { rowModel: TRowModel }): void;
	getSnapshot(): VirtualListSnapshot<TCell, TMountedBuild> | null;
	hasPublishedVisibleRange(): boolean;
	dispose(): void;
}

export interface CreateVirtualizerEngineOptions<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedBuild,
> {
	buildMountedRows(params: {
		rowModel: TRowModel;
		rowRange: RowRange;
		ranges: VirtualRanges;
		previousBuild?: TMountedBuild;
		rowSlotAllocator: ResidentRowSlotAllocator;
	}): TMountedBuild;
	onSnapshotUpdated?(snapshot: VirtualListSnapshot<TCell, TMountedBuild>): void;
}

const EMPTY_RANGE: RowRange = Object.freeze({ start: 0, end: 0 });
const EMPTY_VIRTUAL_RANGES: VirtualRanges = Object.freeze({
	mounted: EMPTY_RANGE,
	previewVisible: EMPTY_RANGE,
});

/** Owns range application, immutable snapshots, and resident physical row slots. */
export function createVirtualizerEngine<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedBuild,
>({
	buildMountedRows,
	onSnapshotUpdated,
}: CreateVirtualizerEngineOptions<TCell, TRowModel, TMountedBuild>): VirtualizerEngine<
	TCell,
	TRowModel,
	TMountedBuild
> {
	let latestSnapshot: VirtualListSnapshot<TCell, TMountedBuild> | null = null;
	let hasPublishedVisibleRange = false;
	const rowSlotAllocator = createResidentRowSlotAllocator();

	function commit(nextSnapshot: VirtualListSnapshot<TCell, TMountedBuild>): void {
		if (latestSnapshot === nextSnapshot) return;
		latestSnapshot = nextSnapshot;
		onSnapshotUpdated?.(nextSnapshot);
	}

	function buildSnapshot(
		rowModel: TRowModel,
		ranges: VirtualRanges,
		previousBuild?: TMountedBuild,
	): VirtualListSnapshot<TCell, TMountedBuild> {
		const mountedBuild = buildMountedRows({
			rowModel,
			rowRange: ranges.mounted,
			ranges,
			previousBuild,
			rowSlotAllocator,
		});
		return createSnapshot(rowModel, ranges, mountedBuild);
	}

	function recomputeSnapshot(
		rowModel: TRowModel,
		previous: VirtualListSnapshot<TCell, TMountedBuild>,
	): VirtualListSnapshot<TCell, TMountedBuild> {
		if (rowModel.rowCount <= 0) return createEmptySnapshot(rowModel);

		const ranges = clampVirtualRanges(previous.ranges, rowModel.rowCount);
		if (
			previous.mountedBuild &&
			previous.rowModel === rowModel &&
			sameRange(previous.ranges.mounted, ranges.mounted)
		) {
			return createSnapshot(rowModel, ranges, previous.mountedBuild);
		}
		return buildSnapshot(rowModel, ranges, previous.mountedBuild ?? undefined);
	}

	function resolveMeasuredSnapshot(
		rowModel: TRowModel,
		rangesResult: Exclude<ComputeVirtualRangesResult, { kind: "skipped" }>,
	): VirtualListSnapshot<TCell, TMountedBuild> {
		const previous = latestSnapshot;
		if (rangesResult.kind === "empty") return createEmptySnapshot(rowModel);

		if (
			previous &&
			previous.rowModel === rowModel &&
			previous.totalHeight === rowModel.totalHeight &&
			previous.mountedBuild &&
			sameRange(previous.ranges.mounted, rangesResult.ranges.mounted)
		) {
			if (
				sameRange(
					previous.ranges.previewVisible,
					rangesResult.ranges.previewVisible,
				)
			) {
				return previous;
			}
			return createSnapshot(rowModel, rangesResult.ranges, previous.mountedBuild);
		}

		return buildSnapshot(
			rowModel,
			rangesResult.ranges,
			previous?.mountedBuild ?? undefined,
		);
	}

	function applyRangeMeasurement(
		nextMeasurement: VirtualMeasurement,
		rowModel: TRowModel,
		visibilityPolicy: VirtualVisibilityPolicy,
		precomputedRanges?: VirtualRanges,
	): MeasurementUpdateResult<RowRange> {
		const previousSnapshot = latestSnapshot;
		const previousMountedBuild = previousSnapshot?.mountedBuild ?? null;
		const rangesResult = computeVirtualRanges({
			rowModel,
			scrollTop: nextMeasurement.scrollTop,
			viewportHeight: nextMeasurement.viewportHeight,
			sectionTop: nextMeasurement.sectionTop,
			hasValidScrollMetrics: nextMeasurement.hasValidScrollMetrics,
			hasPublishedVisibleRange,
			currentMountedRange: previousSnapshot?.ranges.mounted ?? EMPTY_RANGE,
			bootstrapRows: visibilityPolicy.bootstrapRows,
			mountedOverscanPx: visibilityPolicy.mountedOverscanPx,
			previewOverscanPx: visibilityPolicy.previewOverscanPx ?? 0,
			precomputedRanges,
		});

		if (rangesResult.kind === "skipped") {
			const nextSnapshot =
				previousSnapshot?.rowModel === rowModel &&
				previousSnapshot.totalHeight === rowModel.totalHeight
					? previousSnapshot
					: previousSnapshot
						? recomputeSnapshot(rowModel, previousSnapshot)
						: createEmptySnapshot<TCell, TMountedBuild>(rowModel);
			if (nextSnapshot.mountedBuild === null && previousMountedBuild) {
				rowSlotAllocator.reset();
			}
			commit(nextSnapshot);
			return { kind: "skipped", reason: "unstable", updateKind: "skipped" };
		}

		const nextSnapshot = resolveMeasuredSnapshot(rowModel, rangesResult);
		if (nextSnapshot.mountedBuild === null && previousMountedBuild) {
			rowSlotAllocator.reset();
		}
		commit(nextSnapshot);
		const updateKind =
			nextSnapshot.mountedBuild === previousMountedBuild
				? "reused"
				: "recomputed";
		if (rangesResult.kind === "bootstrapped") {
			return {
				kind: "bootstrapped",
				range: nextSnapshot.ranges.mounted,
				updateKind,
			};
		}

		hasPublishedVisibleRange = true;
		return {
			kind: "stable",
			range: nextSnapshot.ranges.mounted,
			updateKind,
		};
	}

	function recompute(params: { rowModel: TRowModel }): void {
		const previousSnapshot = latestSnapshot;
		if (!previousSnapshot) return;
		const nextSnapshot = recomputeSnapshot(params.rowModel, previousSnapshot);
		if (nextSnapshot.mountedBuild === null && previousSnapshot.mountedBuild) {
			rowSlotAllocator.reset();
		}
		commit(nextSnapshot);
	}

	function setEmpty(params: { rowModel: TRowModel }): void {
		rowSlotAllocator.reset();
		commit(createEmptySnapshot(params.rowModel));
	}

	return {
		applyRangeMeasurement,
		recompute,
		setEmpty,
		getSnapshot: () => latestSnapshot,
		hasPublishedVisibleRange: () => hasPublishedVisibleRange,
		dispose: () => rowSlotAllocator.dispose(),
	};
}

function freezeVirtualRanges(ranges: VirtualRanges): VirtualRanges {
	Object.freeze(ranges.mounted);
	Object.freeze(ranges.previewVisible);
	return Object.freeze(ranges);
}

function createSnapshot<TCell, TMountedBuild>(
	rowModel: VirtualRowModel<TCell>,
	ranges: VirtualRanges,
	mountedBuild: TMountedBuild,
): VirtualListSnapshot<TCell, TMountedBuild> {
	return Object.freeze({
		rowModel,
		ranges: freezeVirtualRanges(ranges),
		mountedBuild,
		totalHeight: rowModel.totalHeight,
	});
}

function createEmptySnapshot<TCell, TMountedBuild>(
	rowModel: VirtualRowModel<TCell>,
): VirtualListSnapshot<TCell, TMountedBuild> {
	return Object.freeze({
		rowModel,
		ranges: EMPTY_VIRTUAL_RANGES,
		mountedBuild: null,
		totalHeight: rowModel.totalHeight,
	});
}

function clampVirtualRanges(ranges: VirtualRanges, rowCount: number): VirtualRanges {
	const mounted = clampRange(ranges.mounted, rowCount);
	const previewVisible = clampRange(ranges.previewVisible, rowCount);
	if (
		sameRange(ranges.mounted, mounted) &&
		sameRange(ranges.previewVisible, previewVisible)
	) {
		return ranges;
	}
	return { mounted, previewVisible };
}
