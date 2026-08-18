import { describe, expect, it, vi } from "vitest";
import { computeVirtualGridLayout } from "../../layout/flatGridLayout";
import { createFlatLogicalCellSource } from "../../flatLogicalCellSource";
import type { VirtualListLogicalCell } from "../../logicalCell";
import {
	createFlatLinkRowModel,
	type FlatLinkRowModel,
} from "../../row-models/flatLinkRowModel";
import {
	buildMountedVirtualGridCellsFromRowModel,
	type MountedVirtualGridCell,
	type MountedVirtualGridCellsBuildResult,
} from "../../core/reconciliation/linkListVirtualLayout";
import { createResidentRowSlotAllocator } from "../../core/residentSlotAllocator";
import { useVirtualList, type UseVirtualListOptions } from "../useVirtualList.svelte";

type TestItem = { id: string; label?: string };

const createRowModel = (
	input: number | readonly TestItem[],
): FlatLinkRowModel<TestItem> => {
	const items =
		typeof input === "number"
			? Array.from({ length: input }, (_, index) => ({
					id: `item-${index}`,
				}))
			: input;
	const cellSource = createFlatLogicalCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getItemId: (item) => item.id,
		sectionId: "use-virtual-list",
	});
	const layout = computeVirtualGridLayout({
		containerWidth: 320,
		minCellWidth: 100,
		gap: 10,
		maxColumns: 3,
		rowHeight: 100,
		cellCount: cellSource.cellCount,
	});

	return createFlatLinkRowModel({
		cellSource,
		layout,
	});
};

const createVirtualList = (
	onSnapshotUpdated?: UseVirtualListOptions<
		VirtualListLogicalCell<TestItem>,
		FlatLinkRowModel<TestItem>,
		MountedVirtualGridCell<TestItem>,
		MountedVirtualGridCellsBuildResult<TestItem>
	>["onSnapshotUpdated"],
	buildMountedCells: (params: {
		rowModel: FlatLinkRowModel<TestItem>;
		rowRange: Parameters<
			typeof buildMountedVirtualGridCellsFromRowModel
		>[0]["rowRange"];
		previousBuild?: MountedVirtualGridCellsBuildResult<TestItem>;
		rowSlotAllocator: ReturnType<typeof createResidentRowSlotAllocator>;
	}) => MountedVirtualGridCellsBuildResult<TestItem> = buildMountedVirtualGridCellsFromRowModel,
) => {
	const rowSlotAllocator = createResidentRowSlotAllocator();
	return useVirtualList<
		VirtualListLogicalCell<TestItem>,
		FlatLinkRowModel<TestItem>,
		MountedVirtualGridCell<TestItem>,
		MountedVirtualGridCellsBuildResult<TestItem>
	>({
		buildMountedCells: ({ rowModel, rowRange, previousBuild }) =>
			buildMountedCells({
				rowModel,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			}),
		onSnapshotUpdated,
	});
};

describe("useVirtualList", () => {
	it("starts uninitialized", () => {
		const virtualList = createVirtualList();

		expect(virtualList.getSnapshot()).toBeNull();
		expect(virtualList.getMountedCells()).toEqual([]);
		expect(virtualList.getMountedBuild()).toBeNull();
	});

	it("bootstraps mounted rows without publishing preview-visible rows", () => {
		const rowModel = createRowModel(12);
		const virtualList = createVirtualList();

		const result = virtualList.bootstrap({
			rowModel,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 220,
			},
		});

		expect(result).toEqual({
			kind: "bootstrapped",
			range: { start: 0, end: 3 },
			updateKind: "recomputed",
		});
		expect(virtualList.getSnapshot()?.ranges).toEqual({
			mounted: { start: 0, end: 3 },
			previewVisible: { start: 0, end: 0 },
		});
	});

	it("keeps the latest engine snapshot after measurement updates", () => {
		const rowModel = createRowModel(12);
		const virtualList = createVirtualList();
		const result = virtualList.applyMeasurement({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 220,
			},
		});
		const snapshot = virtualList.getSnapshot();

		expect(result).toEqual({
			kind: "stable",
			range: { start: 0, end: 3 },
			updateKind: "recomputed",
		});
		expect(snapshot?.ranges.mounted).toEqual({ start: 0, end: 3 });
		expect(snapshot?.mode.kind).toBe("stable");
		expect(virtualList.getMountedCells()).toBe(snapshot?.mountedBuild?.cells);
		expect(virtualList.getTotalHeight(123)).toBe(snapshot?.totalHeight);
		expect(
			snapshot?.mountedBuild?.cells.every(
				(cell) => !Object.prototype.hasOwnProperty.call(cell, "visibility"),
			),
		).toBe(true);
	});

	it("reflects active scrolling in stable mode", () => {
		const rowModel = createRowModel(12);
		const virtualList = createVirtualList();

		virtualList.applyMeasurement({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			isScrollActive: true,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 220,
			},
		});

		expect(virtualList.getSnapshot()?.mode).toEqual({
			kind: "stable",
			scrolling: true,
		});
	});

	it("does not rebuild mounted cells when row model and all ranges are unchanged", () => {
		const buildMountedCells = vi.fn(
			buildMountedVirtualGridCellsFromRowModel<TestItem>,
		);
		const rowModel = createRowModel(12);
		const virtualList = createVirtualList(undefined, buildMountedCells);
		const measurement = {
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 220,
			},
		};

		const initialResult = virtualList.applyMeasurement(measurement);
		const initial = virtualList.getSnapshot();
		const reusedResult = virtualList.applyMeasurement({
			...measurement,
			hasStableVisibleRange: true,
		});

		expect(initialResult.updateKind).toBe("recomputed");
		expect(reusedResult.updateKind).toBe("reused");
		expect(virtualList.getSnapshot()?.mountedBuild?.cells).toBe(
			initial?.mountedBuild?.cells,
		);
		expect(buildMountedCells).toHaveBeenCalledTimes(1);
	});

	it("recomputes payloads without losing render slots", () => {
		const virtualList = createVirtualList();
		const initialRowModel = createRowModel([
			{ id: "item-0", label: "Initial 0" },
			{ id: "item-1", label: "Initial 1" },
			{ id: "item-2", label: "Initial 2" },
		]);
		virtualList.applyMeasurement({
			rowModel: initialRowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 0,
			},
		});
		const initial = virtualList.getSnapshot();
		const updatedRowModel = createRowModel([
			{ id: "item-0", label: "Updated 0" },
			{ id: "item-1", label: "Updated 1" },
			{ id: "item-2", label: "Updated 2" },
		]);

		virtualList.recompute({ rowModel: updatedRowModel });

		const updated = virtualList.getSnapshot();
		const first = updated?.mountedBuild?.cells[0];
		expect(first?.renderSlotIndex).toBe(
			initial?.mountedBuild?.cells[0]?.renderSlotIndex,
		);
		expect(first?.cell.kind).toBe("item");
		if (!first || first.cell.kind !== "item") {
			return;
		}
		expect(first.cell.item.label).toBe("Updated 0");
		expect(first.cell.item).not.toBe(
			(initial?.mountedBuild?.cells[0]?.cell as typeof first.cell).item,
		);
	});

	it("notifies consumers after measurement and recompute snapshot updates", () => {
		const onSnapshotUpdated = vi.fn();
		const virtualList = createVirtualList(onSnapshotUpdated);
		const initialRowModel = createRowModel([
			{ id: "item-0", label: "Initial 0" },
			{ id: "item-1", label: "Initial 1" },
			{ id: "item-2", label: "Initial 2" },
		]);
		virtualList.applyMeasurement({
			rowModel: initialRowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 0,
			},
		});
		const measured = virtualList.getSnapshot();
		const updatedRowModel = createRowModel([
			{ id: "item-0", label: "Updated 0" },
			{ id: "item-1", label: "Updated 1" },
			{ id: "item-2", label: "Updated 2" },
		]);

		virtualList.recompute({ rowModel: updatedRowModel });

		expect(onSnapshotUpdated).toHaveBeenCalledTimes(2);
		expect(onSnapshotUpdated).toHaveBeenNthCalledWith(1, measured);
		expect(onSnapshotUpdated).toHaveBeenNthCalledWith(2, virtualList.getSnapshot());
	});

	it("does not notify consumers when measurement reuses cells and snapshot identity is preserved", () => {
		const onSnapshotUpdated = vi.fn();
		const virtualList = createVirtualList(onSnapshotUpdated);
		const rowModel = createRowModel(12);
		const measurement = {
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 220,
			},
		};

		virtualList.applyMeasurement(measurement);
		const initial = virtualList.getSnapshot();
		virtualList.applyMeasurement({
			...measurement,
			hasStableVisibleRange: true,
		});

		expect(virtualList.getSnapshot()?.mountedBuild?.cells).toBe(
			initial?.mountedBuild?.cells,
		);
		expect(onSnapshotUpdated).toHaveBeenCalledTimes(1);
	});

	it("returns skipped and publishes skipped mode when unstable measurement keeps the same content", () => {
		const onSnapshotUpdated = vi.fn();
		const virtualList = createVirtualList(onSnapshotUpdated);
		const rowModel = createRowModel(12);
		const measurement = {
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 220,
			},
		};

		virtualList.applyMeasurement(measurement);
		const initial = virtualList.getSnapshot();
		const result = virtualList.applyMeasurement({
			...measurement,
			scrollTop: 100,
			isStableMeasurement: false,
			hasStableVisibleRange: true,
		});

		expect(result).toEqual({
			kind: "skipped",
			reason: "unstable",
			updateKind: "skipped",
		});
		expect(virtualList.getSnapshot()).not.toBe(initial);
		expect(virtualList.getSnapshot()?.mountedBuild?.cells).toBe(
			initial?.mountedBuild?.cells,
		);
		expect(virtualList.getSnapshot()?.mode.kind).toBe("skipped");
		expect(onSnapshotUpdated).toHaveBeenCalledTimes(2);
	});

	it("transitions to empty explicitly and clears mounted cells", () => {
		const onSnapshotUpdated = vi.fn();
		const virtualList = createVirtualList(onSnapshotUpdated);
		const rowModel = createRowModel(12);
		virtualList.applyMeasurement({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 220,
			},
		});

		virtualList.setEmpty({
			rowModel,
			reason: "no-renderable-content",
		});

		expect(virtualList.getSnapshot()?.mode).toEqual({
			kind: "empty",
			reason: "no-renderable-content",
		});
		expect(virtualList.getMountedCells()).toEqual([]);
		expect(virtualList.getSnapshot()?.mountedBuild).toBeNull();
		expect(virtualList.getMountedBuild()).toBeNull();
		expect(onSnapshotUpdated).toHaveBeenCalledTimes(2);
	});

	it("recomputes from empty without returning old mounted cells", () => {
		const virtualList = createVirtualList();
		const rowModel = createRowModel(12);
		virtualList.applyMeasurement({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 220,
			},
		});
		const initialCells = virtualList.getMountedCells();
		virtualList.setEmpty({ rowModel });

		virtualList.applyMeasurement({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: false,
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 220,
			},
		});

		expect(virtualList.getSnapshot()?.mode.kind).toBe("stable");
		expect(virtualList.getMountedCells()).not.toBe(initialCells);
		expect(virtualList.getMountedCells()[0]?.renderSlotIndex).toBe(0);
	});
});
