import { describe, expect, it, vi } from "vitest";
import { computeFlatGridLayout } from "cards/virtualization/public";
import { createFlatGridCellSource } from "../cellSource";
import type { FlatGridLogicalCell } from "../logicalCell";
import { createFlatGridRowModel, type FlatGridRowModel } from "../rowModel";
import type { VirtualRanges } from "cards/virtualization/public";
import { computeVirtualRanges } from "cards/virtualization/public";
import {
	buildMountedFlatGridCells,
	type MountedFlatGridCell,
	type MountedFlatGridBuild,
} from "../mountedCells";
import {
	computeVirtualListSnapshot,
	recomputeVirtualListSnapshot,
	type VirtualListComputation,
	type VirtualListSnapshot,
} from "cards/virtualization/engine/snapshotComputation";
import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
} from "cards/virtualization/public";

interface TestItem {
	readonly id: string;
}

type TestSnapshot = VirtualListSnapshot<
	FlatGridLogicalCell<TestItem>,
	MountedFlatGridCell<TestItem>,
	MountedFlatGridBuild<TestItem>
>;
type TestComputation = VirtualListComputation<
	FlatGridLogicalCell<TestItem>,
	MountedFlatGridCell<TestItem>,
	MountedFlatGridBuild<TestItem>
>;
const rowSlotAllocators = new WeakMap<TestSnapshot, ResidentRowSlotAllocator>();

const createRowModel = (count: number): FlatGridRowModel<TestItem> => {
	const items = Array.from({ length: count }, (_, index) => ({
		id: `item-${index}`,
	}));
	const cellSource = createFlatGridCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getItemId: (item) => item.id,
		sectionId: "engine-contract",
	});
	const layout = computeFlatGridLayout({
		containerWidth: 320,
		minCellWidth: 100,
		gap: 10,
		maxColumns: 3,
		rowHeight: 100,
		cellCount: cellSource.cellCount,
	});

	return createFlatGridRowModel({ cellSource, layout });
};

const compute = (params: {
	readonly rowModel: FlatGridRowModel<TestItem>;
	readonly previous?: TestSnapshot;
	readonly ranges?: VirtualRanges;
	readonly scrollTop?: number;
	readonly mountedOverscanPx?: number;
	readonly buildMountedCells?: typeof buildMountedFlatGridCells<TestItem>;
	readonly rowSlotAllocator?: ResidentRowSlotAllocator;
}): TestComputation => {
	const rowSlotAllocator =
		params.rowSlotAllocator ??
		(params.previous ? rowSlotAllocators.get(params.previous) : undefined) ??
		createResidentRowSlotAllocator();
	const rangesResult = computeVirtualRanges({
		rowModel: params.rowModel,
		scrollTop: params.scrollTop ?? 0,
		viewportHeight: 100,
		sectionTop: 0,
		isStableMeasurement: true,
		hasStableVisibleRange: params.previous !== undefined,
		currentMountedRange: params.previous?.ranges.mounted ?? {
			start: 0,
			end: 0,
		},
		bootstrapRows: 3,
		mountedOverscanPx: params.mountedOverscanPx ?? 0,
		precomputedRanges: params.ranges,
	});
	const result = computeVirtualListSnapshot({
		rowModel: params.rowModel,
		rangesResult,
		previous: params.previous,
		buildMountedCells: ({ rowModel, rowRange, previousBuild }) =>
			(params.buildMountedCells ?? buildMountedFlatGridCells)({
				rowModel: rowModel as FlatGridRowModel<TestItem>,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			}),
	});
	rowSlotAllocators.set(result.snapshot, rowSlotAllocator);
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

		expect(
			initial.mountedBuild!.cells.map((cell) => cell.physicalCellSlot),
		).toEqual([0, 1, 2]);
		expect(
			shifted.mountedBuild!.cells.map((cell) => cell.physicalCellSlot),
		).toEqual([0, 1, 2]);
		expect(
			new Set(shifted.mountedBuild!.cells.map((cell) => cell.physicalCellSlot))
				.size,
		).toBe(shifted.mountedBuild!.cells.length);
	});

	it("publishes no visibility metadata or mounted-cell key index", () => {
		const snapshot = compute({
			rowModel: createRowModel(12),
			mountedOverscanPx: 220,
		}).snapshot;

		expect(snapshot.ranges.mounted).toEqual({ start: 0, end: 3 });
		expect("mountedCellsByKey" in snapshot).toBe(false);
		expect(snapshot.mountedBuild).not.toBeNull();
		expect(
			snapshot.mountedBuild!.cells.every(
				(cell) => !Object.prototype.hasOwnProperty.call(cell, "visibility"),
			),
		).toBe(true);
	});

	it("publishes frozen snapshot and range objects", () => {
		const snapshot = compute({ rowModel: createRowModel(12) }).snapshot;

		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.ranges)).toBe(true);
		expect(Object.isFrozen(snapshot.ranges.mounted)).toBe(true);
		expect(Object.isFrozen(snapshot.ranges.previewVisible)).toBe(true);
	});

	it("reuses the mounted build and cells when only previewVisible changes", () => {
		const rowModel = createRowModel(30);
		const buildMountedCells = vi.fn(buildMountedFlatGridCells<TestItem>);
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
		expect(nextResult.snapshot.mountedBuild!.cells).toBe(
			initialResult.snapshot.mountedBuild!.cells,
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
		const buildMountedCells = vi.fn(buildMountedFlatGridCells<TestItem>);
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
		expect(shifted.mountedBuild!.cells).not.toBe(initial.mountedBuild!.cells);
	});

	it("recompute reuses mounted cells when mounted dependencies are unchanged", () => {
		const rowModel = createRowModel(12);
		const initialResult = compute({ rowModel });
		const buildMountedCells = vi.fn(buildMountedFlatGridCells<TestItem>);

		const recomputed = recomputeVirtualListSnapshot({
			rowModel,
			previous: initialResult.snapshot,
			buildMountedCells: ({ rowModel: nextRowModel, rowRange, previousBuild }) =>
				buildMountedCells({
					rowModel: nextRowModel as FlatGridRowModel<TestItem>,
					rowRange,
					previousBuild,
					rowSlotAllocator: createResidentRowSlotAllocator(),
				}),
		});

		expect(buildMountedCells).not.toHaveBeenCalled();
		expect(recomputed.snapshot.mountedBuild!.cells).toBe(
			initialResult.snapshot.mountedBuild!.cells,
		);
	});

	it("returns an empty snapshot when the row model has no rows", () => {
		const result = compute({ rowModel: createRowModel(0) });

		expect(result.snapshot.mountedBuild).toBeNull();
		expect(result.snapshot.ranges).toEqual({
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		});
	});
});
