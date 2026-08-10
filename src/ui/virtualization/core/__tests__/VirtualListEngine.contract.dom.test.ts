import { describe, expect, it, vi } from "vitest";
import { computeVirtualGridLayout } from "../../layout/flatGridLayout";
import { createFlatLogicalCellSource } from "../../flatLogicalCellSource";
import type { VirtualListLogicalCell } from "../../logicalCell";
import {
	createFlatLinkRowModel,
	type FlatLinkRowModel,
} from "../../row-models/flatLinkRowModel";
import type { VirtualRanges } from "../../types";
import {
	buildMountedVirtualGridCellsFromRowModel,
	type MountedVirtualGridCell,
	type MountedVirtualGridCellsBuildResult,
} from "../reconciliation/linkListVirtualLayout";
import {
	computeVirtualListSnapshotWithState,
	recomputeVirtualListSnapshotWithState,
	type VirtualListComputation,
	type VirtualListReconciliationState,
	type VirtualListSnapshot,
} from "../virtualListEngine";

interface TestItem {
	readonly id: string;
}

type TestSnapshot = VirtualListSnapshot<
	VirtualListLogicalCell<TestItem>,
	MountedVirtualGridCell<TestItem>,
	MountedVirtualGridCellsBuildResult<TestItem>
>;
type TestReconciliationState = VirtualListReconciliationState<
	MountedVirtualGridCellsBuildResult<TestItem>
>;
type TestComputation = VirtualListComputation<
	VirtualListLogicalCell<TestItem>,
	MountedVirtualGridCell<TestItem>,
	MountedVirtualGridCellsBuildResult<TestItem>
>;

const stateBySnapshot = new WeakMap<TestSnapshot, TestReconciliationState>();

const createRowModel = (count: number): FlatLinkRowModel<TestItem> => {
	const items = Array.from({ length: count }, (_, index) => ({
		id: `item-${index}`,
	}));
	const cellSource = createFlatLogicalCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getKey: (item) => item.id,
		sectionId: "engine-contract",
	});
	const layout = computeVirtualGridLayout({
		containerWidth: 320,
		minCellWidth: 100,
		gap: 10,
		maxColumns: 3,
		rowHeight: 100,
		cellCount: cellSource.cellCount,
	});

	return createFlatLinkRowModel({ cellSource, layout });
};

const compute = (params: {
	readonly rowModel: FlatLinkRowModel<TestItem>;
	readonly previous?: TestSnapshot;
	readonly ranges?: VirtualRanges;
	readonly scrollTop?: number;
	readonly mountedOverscanPx?: number;
	readonly buildMountedCells?: typeof buildMountedVirtualGridCellsFromRowModel<TestItem>;
}): TestComputation => {
	const result = computeVirtualListSnapshotWithState({
		rowModel: params.rowModel,
		measurement: {
			scrollTop: params.scrollTop ?? 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: params.previous !== undefined,
			currentMountedRange: params.previous?.ranges.mounted ?? {
				start: 0,
				end: 0,
			},
			precomputedRanges: params.ranges,
		},
		visibilityPolicy: {
			bootstrapRows: 3,
			mountedOverscanPx: params.mountedOverscanPx ?? 0,
		},
		previous: params.previous,
		previousState: params.previous
			? stateBySnapshot.get(params.previous)
			: undefined,
		buildMountedCells: ({ rowModel, rowRange, previousBuild }) =>
			(params.buildMountedCells ?? buildMountedVirtualGridCellsFromRowModel)({
				rowModel: rowModel as FlatLinkRowModel<TestItem>,
				rowRange,
				previousBuild,
			}),
	});
	stateBySnapshot.set(result.snapshot, result.reconciliationState);
	return result;
};

describe("VirtualListEngine contract", () => {
	it("keeps render slots unique and reuses physical slots while scrolling", () => {
		const rowModel = createRowModel(12);
		const initial = compute({ rowModel }).snapshot;
		const shifted = compute({
			rowModel,
			previous: initial,
			scrollTop: 110,
		}).snapshot;

		expect(initial.mountedCells.map((cell) => cell.renderSlotKey)).toEqual([
			0, 1, 2,
		]);
		expect(shifted.mountedCells.map((cell) => cell.renderSlotKey)).toEqual([
			0, 1, 2,
		]);
		expect(
			new Set(shifted.mountedCells.map((cell) => cell.renderSlotIndex)).size,
		).toBe(shifted.mountedCells.length);
	});

	it("publishes no visibility metadata or mounted-cell key index", () => {
		const snapshot = compute({
			rowModel: createRowModel(12),
			mountedOverscanPx: 220,
		}).snapshot;

		expect(snapshot.ranges.mounted).toEqual({ start: 0, end: 3 });
		expect("mountedCellsByKey" in snapshot).toBe(false);
		expect("mountedBuild" in snapshot).toBe(false);
		expect(
			snapshot.mountedCells.every(
				(cell) => !Object.prototype.hasOwnProperty.call(cell, "visibility"),
			),
		).toBe(true);
	});

	it("reuses the mounted build and cells when only previewVisible changes", () => {
		const rowModel = createRowModel(30);
		const buildMountedCells = vi.fn(
			buildMountedVirtualGridCellsFromRowModel<TestItem>,
		);
		const initialResult = compute({
			rowModel,
			ranges: {
				mounted: { start: 0, end: 7 },
				previewVisible: { start: 0, end: 1 },
			},
			buildMountedCells,
		});
		const nextResult = compute({
			rowModel,
			previous: initialResult.snapshot,
			ranges: {
				mounted: { start: 0, end: 7 },
				previewVisible: { start: 1, end: 2 },
			},
			buildMountedCells,
		});

		expect(buildMountedCells).toHaveBeenCalledTimes(1);
		expect(nextResult.snapshot).not.toBe(initialResult.snapshot);
		expect(nextResult.snapshot.ranges.previewVisible).toEqual({ start: 1, end: 2 });
		expect(nextResult.reconciliationState).toBe(initialResult.reconciliationState);
		expect(nextResult.snapshot.mountedCells).toBe(
			initialResult.snapshot.mountedCells,
		);
	});

	it("reuses the entire snapshot for a no-op measurement", () => {
		const rowModel = createRowModel(30);
		const ranges = {
			mounted: { start: 0, end: 4 },
			previewVisible: { start: 0, end: 1 },
		};
		const initial = compute({ rowModel, ranges }).snapshot;
		const repeated = compute({ rowModel, previous: initial, ranges }).snapshot;

		expect(repeated).toBe(initial);
	});

	it("rebuilds when the mounted range changes", () => {
		const rowModel = createRowModel(30);
		const buildMountedCells = vi.fn(
			buildMountedVirtualGridCellsFromRowModel<TestItem>,
		);
		const initial = compute({
			rowModel,
			ranges: {
				mounted: { start: 0, end: 3 },
				previewVisible: { start: 0, end: 1 },
			},
			buildMountedCells,
		}).snapshot;
		const shifted = compute({
			rowModel,
			previous: initial,
			ranges: {
				mounted: { start: 1, end: 4 },
				previewVisible: { start: 1, end: 2 },
			},
			buildMountedCells,
		}).snapshot;

		expect(buildMountedCells).toHaveBeenCalledTimes(2);
		expect(shifted.mountedCells).not.toBe(initial.mountedCells);
	});

	it("recompute reuses mounted cells when mounted dependencies are unchanged", () => {
		const rowModel = createRowModel(12);
		const initialResult = compute({ rowModel });
		const buildMountedCells = vi.fn(
			buildMountedVirtualGridCellsFromRowModel<TestItem>,
		);

		const recomputed = recomputeVirtualListSnapshotWithState({
			rowModel,
			previous: initialResult.snapshot,
			previousState: initialResult.reconciliationState,
			buildMountedCells: ({ rowModel: nextRowModel, rowRange, previousBuild }) =>
				buildMountedCells({
					rowModel: nextRowModel as FlatLinkRowModel<TestItem>,
					rowRange,
					previousBuild,
				}),
		});

		expect(buildMountedCells).not.toHaveBeenCalled();
		expect(recomputed.snapshot.mountedCells).toBe(
			initialResult.snapshot.mountedCells,
		);
		expect(recomputed.reconciliationState).toBe(initialResult.reconciliationState);
	});

	it("returns an empty snapshot when the row model has no rows", () => {
		const result = compute({ rowModel: createRowModel(0) });

		expect(result.snapshot.mountedCells).toEqual([]);
		expect(result.snapshot.ranges).toEqual({
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		});
		expect(result.reconciliationState.mountedBuild).toBeNull();
	});
});
