import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
} from "../reconciliation/linkListVirtualLayout";
import {
	computeVirtualListSnapshotWithState,
	recomputeVirtualListSnapshotWithState,
	resolveVirtualizedItemVisibility,
	type VirtualListReconciliationState,
	type VirtualListSnapshot,
	type VirtualListComputation,
	type VirtualCellVisibilityMetadataPolicy,
} from "../virtualListEngine";

type TestItem = { id: string; label?: string };
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

const createRowModel = (
	input: number | readonly TestItem[],
	layoutOverrides: {
		containerWidth?: number;
		minCellWidth?: number;
		gap?: number;
		maxColumns?: number;
		rowHeight?: number;
	} = {},
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
		getKey: (item) => item.id,
		sectionId: "engine-contract",
	});
	const layout = computeVirtualGridLayout({
		containerWidth: layoutOverrides.containerWidth ?? 320,
		minCellWidth: layoutOverrides.minCellWidth ?? 100,
		gap: layoutOverrides.gap ?? 10,
		maxColumns: layoutOverrides.maxColumns ?? 3,
		rowHeight: layoutOverrides.rowHeight ?? 100,
		cellCount: cellSource.cellCount,
	});

	return createFlatLinkRowModel({
		cellSource,
		layout,
	});
};

const computeComputation = (params: {
	rowModel: FlatLinkRowModel<TestItem>;
	scrollTop: number;
	viewportHeight?: number;
	isStableMeasurement?: boolean;
	hasStableVisibleRange?: boolean;
	previous?: TestSnapshot | null;
	bootstrapRows?: number;
	mountedOverscanPx?: number;
	visibilityMetadataPolicy?: VirtualCellVisibilityMetadataPolicy;
	isScrollActive?: boolean;
}): TestComputation => {
	const result = computeVirtualListSnapshotWithState({
		rowModel: params.rowModel,
		measurement: {
			scrollTop: params.scrollTop,
			viewportHeight: params.viewportHeight ?? 100,
			sectionTop: 0,
			isStableMeasurement: params.isStableMeasurement ?? true,
			isScrollActive: params.isScrollActive,
			hasStableVisibleRange:
				params.hasStableVisibleRange ?? Boolean(params.previous),
			currentMountedRange: params.previous?.ranges.mounted ?? {
				start: 0,
				end: 0,
			},
		},
		visibilityPolicy: {
			bootstrapRows: params.bootstrapRows ?? 3,
			mountedOverscanPx: params.mountedOverscanPx ?? 0,
		},
		previous: params.previous,
		previousState: params.previous
			? stateBySnapshot.get(params.previous)
			: undefined,
		visibilityMetadataPolicy: params.visibilityMetadataPolicy,
		buildMountedCells: ({
			rowModel,
			rowRange,
			previousBuild,
			previousCellsByKey,
		}) =>
			buildMountedVirtualGridCellsFromRowModel({
				rowModel: rowModel as FlatLinkRowModel<TestItem>,
				rowRange,
				previousBuild,
				previousCellsByKey,
			}),
	});
	stateBySnapshot.set(result.snapshot, result.reconciliationState);
	return result;
};

const computeSnapshot = (
	params: Parameters<typeof computeComputation>[0],
): TestSnapshot => {
	return computeComputation(params).snapshot;
};

const expectUniqueRenderSlots = (
	cells: readonly MountedVirtualGridCell<TestItem>[],
): void => {
	const slots = cells.map((cell) => cell.renderSlotIndex);
	expect(new Set(slots).size).toBe(slots.length);
};

describe("VirtualListEngine contract", () => {
	it("keeps DOM slots unique and reuses them when logical cells scroll", () => {
		const rowModel = createRowModel(12);
		const initial = computeSnapshot({ rowModel, scrollTop: 0 });
		const shifted = computeSnapshot({
			rowModel,
			scrollTop: 110,
			previous: initial,
		});

		expect(initial.mountedCells.map((cell) => cell.key)).toEqual([
			"item-0::item:0",
			"item-1::item:1",
			"item-2::item:2",
		]);
		expect(shifted.mountedCells.map((cell) => cell.key)).toEqual([
			"item-3::item:3",
			"item-4::item:4",
			"item-5::item:5",
		]);
		expect(initial.mountedCells.map((cell) => cell.renderSlotKey)).toEqual([
			0, 1, 2,
		]);
		expect(shifted.mountedCells.map((cell) => cell.renderSlotKey)).toEqual([
			0, 1, 2,
		]);
		expectUniqueRenderSlots(shifted.mountedCells);
	});

	it("keeps renderSlotIndex unique within a snapshot", () => {
		const rowModel = createRowModel(30);
		const snapshot = computeSnapshot({
			rowModel,
			scrollTop: 100,
			viewportHeight: 300,
		});

		expectUniqueRenderSlots(snapshot.mountedCells);
	});

	it("keeps reconciliation state out of the public snapshot", () => {
		const rowModel = createRowModel(12);
		const initial = computeSnapshot({ rowModel, scrollTop: 0 });
		const initialCellsByKey = initial.mountedCellsByKey;
		const initialFirstCell = initial.mountedCells[0];

		const shifted = computeSnapshot({
			rowModel,
			scrollTop: 110,
			previous: initial,
		});

		expect("mountedBuild" in initial).toBe(false);
		expect("mountedBuild" in shifted).toBe(false);
		expect(initial.mountedCellsByKey).toBe(initialCellsByKey);
		expect(initial.mountedCellsByKey.get(initialFirstCell.key)).toBe(
			initialFirstCell,
		);
		expect(shifted.mountedCellsByKey).not.toBe(initialCellsByKey);
	});

	it("marks mounted cells as visible or mounted from preview ranges", () => {
		const rowModel = createRowModel(12);
		const snapshot = computeSnapshot({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			mountedOverscanPx: 220,
		});

		expect(snapshot.ranges.previewVisible).toEqual({ start: 0, end: 1 });
		expect(snapshot.ranges.mounted).toEqual({ start: 0, end: 3 });
		expect(
			snapshot.mountedCells
				.filter((cell) => cell.position.row === 0)
				.map((cell) => cell.visibility),
		).toEqual(["visible", "visible", "visible"]);
		expect(
			snapshot.mountedCells
				.filter((cell) => cell.position.row === 1)
				.map((cell) => cell.visibility),
		).toEqual(["mounted", "mounted", "mounted"]);
		expect(
			snapshot.mountedCells
				.filter((cell) => cell.position.row === 2)
				.map((cell) => cell.visibility),
		).toEqual(["mounted", "mounted", "mounted"]);
	});

	it("resolves item visibility from row ranges without component-local logic", () => {
		const ranges = {
			mounted: { start: 0, end: 5 },
			previewVisible: { start: 1, end: 2 },
		};

		expect(resolveVirtualizedItemVisibility(1, ranges)).toBe("visible");
		expect(resolveVirtualizedItemVisibility(2, ranges)).toBe("mounted");
		expect(resolveVirtualizedItemVisibility(4, ranges)).toBe("mounted");
		expect(resolveVirtualizedItemVisibility(undefined, ranges)).toBe("mounted");
	});

	it("can skip visibility metadata while preserving render slot metadata", () => {
		const rowModel = createRowModel(12);
		const snapshot = computeSnapshot({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			mountedOverscanPx: 220,
			visibilityMetadataPolicy: { type: "caller-managed" },
		});

		expect(snapshot.mountedCells.length).toBeGreaterThan(0);
		expect(snapshot.mountedCells[0]?.renderSlotKey).toBe(0);
		expect(
			snapshot.mountedCells.map((cell) =>
				Object.prototype.hasOwnProperty.call(cell, "visibility"),
			),
		).toEqual(snapshot.mountedCells.map(() => false));
	});

	it("keeps caller-managed snapshot getters lazy when reusing mounted rows", () => {
		const rowModel = createRowModel(12);
		const initial = computeSnapshot({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			mountedOverscanPx: 1000,
			visibilityMetadataPolicy: { type: "caller-managed" },
		});
		const mountedCellsDescriptor = Object.getOwnPropertyDescriptor(
			initial,
			"mountedCells",
		);
		const mountedCellsByKeyDescriptor = Object.getOwnPropertyDescriptor(
			initial,
			"mountedCellsByKey",
		);
		const getMountedCells = mountedCellsDescriptor?.get;
		const getMountedCellsByKey = mountedCellsByKeyDescriptor?.get;
		if (!getMountedCells || !getMountedCellsByKey) {
			throw new Error("Expected caller-managed snapshot getters.");
		}
		let mountedCellsReadCount = 0;
		let mountedCellsByKeyReadCount = 0;
		Object.defineProperty(initial, "mountedCells", {
			...mountedCellsDescriptor,
			get() {
				mountedCellsReadCount += 1;
				return getMountedCells.call(initial);
			},
		});
		Object.defineProperty(initial, "mountedCellsByKey", {
			...mountedCellsByKeyDescriptor,
			get() {
				mountedCellsByKeyReadCount += 1;
				return getMountedCellsByKey.call(initial);
			},
		});

		const activeScroll = computeComputation({
			rowModel,
			scrollTop: 20,
			viewportHeight: 100,
			mountedOverscanPx: 1000,
			visibilityMetadataPolicy: { type: "caller-managed" },
			isScrollActive: true,
			previous: initial,
		});

		expect(Object.is(activeScroll.snapshot, initial)).toBe(false);
		expect(activeScroll.snapshot.ranges.previewVisible).toEqual({
			start: 0,
			end: 2,
		});
		expect(mountedCellsReadCount).toBe(0);
		expect(mountedCellsByKeyReadCount).toBe(0);
	});

	it("does not read previous mountedCellsByKey when the key index is not provided", () => {
		const rowModel = createRowModel(30);
		const initial = computeSnapshot({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			mountedOverscanPx: 0,
			visibilityMetadataPolicy: { type: "caller-managed" },
		});
		const mountedCellsByKeyDescriptor = Object.getOwnPropertyDescriptor(
			initial,
			"mountedCellsByKey",
		);
		const getMountedCellsByKey = mountedCellsByKeyDescriptor?.get;
		if (!getMountedCellsByKey) {
			throw new Error(
				"Expected caller-managed snapshot mountedCellsByKey getter.",
			);
		}
		let mountedCellsByKeyReadCount = 0;
		Object.defineProperty(initial, "mountedCellsByKey", {
			...mountedCellsByKeyDescriptor,
			get() {
				mountedCellsByKeyReadCount += 1;
				return getMountedCellsByKey.call(initial);
			},
		});
		let computePreviousCellsByKey:
			| ReadonlyMap<string, MountedVirtualGridCell<TestItem>>
			| undefined;

		computeVirtualListSnapshotWithState({
			rowModel,
			measurement: {
				scrollTop: 500,
				viewportHeight: 100,
				sectionTop: 0,
				isStableMeasurement: true,
				hasStableVisibleRange: true,
				currentMountedRange: initial.ranges.mounted,
			},
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 0,
			},
			previous: initial,
			previousState: stateBySnapshot.get(initial),
			visibilityMetadataPolicy: { type: "caller-managed" },
			providePreviousCellsByKey: false,
			buildMountedCells: ({
				rowModel,
				rowRange,
				previousBuild,
				previousCellsByKey,
			}) => {
				computePreviousCellsByKey = previousCellsByKey;
				return buildMountedVirtualGridCellsFromRowModel({
					rowModel: rowModel as FlatLinkRowModel<TestItem>,
					rowRange,
					previousBuild,
					previousCellsByKey,
				});
			},
		});

		let recomputePreviousCellsByKey:
			| ReadonlyMap<string, MountedVirtualGridCell<TestItem>>
			| undefined;
		recomputeVirtualListSnapshotWithState({
			rowModel: createRowModel(30),
			previous: initial,
			previousState: stateBySnapshot.get(initial),
			visibilityMetadataPolicy: { type: "caller-managed" },
			providePreviousCellsByKey: false,
			buildMountedCells: ({
				rowModel,
				rowRange,
				previousBuild,
				previousCellsByKey,
			}) => {
				recomputePreviousCellsByKey = previousCellsByKey;
				return buildMountedVirtualGridCellsFromRowModel({
					rowModel: rowModel as FlatLinkRowModel<TestItem>,
					rowRange,
					previousBuild,
					previousCellsByKey,
				});
			},
		});

		expect(computePreviousCellsByKey).toBeUndefined();
		expect(recomputePreviousCellsByKey).toBeUndefined();
		expect(mountedCellsByKeyReadCount).toBe(0);
	});

	it("updates caller-managed ranges during active scroll when only preview visibility changes", () => {
		const rowModel = createRowModel(12);
		const initial = computeSnapshot({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			mountedOverscanPx: 1000,
			visibilityMetadataPolicy: { type: "caller-managed" },
		});

		const activeScroll = computeComputation({
			rowModel,
			scrollTop: 20,
			viewportHeight: 100,
			mountedOverscanPx: 1000,
			visibilityMetadataPolicy: { type: "caller-managed" },
			isScrollActive: true,
			previous: initial,
		});

		expect(initial.ranges.mounted).toEqual({ start: 0, end: 4 });
		expect(initial.ranges.previewVisible).toEqual({ start: 0, end: 1 });
		expect(activeScroll.snapshot).not.toBe(initial);
		expect(activeScroll.snapshot.ranges.mounted).toEqual(initial.ranges.mounted);
		expect(activeScroll.snapshot.ranges.previewVisible).toEqual({
			start: 0,
			end: 2,
		});
		expect(activeScroll.snapshot.mountedCells).toBe(initial.mountedCells);
		expect(activeScroll.snapshot.mountedCellsByKey).toBe(initial.mountedCellsByKey);
		expect(activeScroll.reconciliationState).toBe(stateBySnapshot.get(initial));

		const repeatedActiveScroll = computeSnapshot({
			rowModel,
			scrollTop: 20,
			viewportHeight: 100,
			mountedOverscanPx: 1000,
			visibilityMetadataPolicy: { type: "caller-managed" },
			isScrollActive: true,
			previous: activeScroll.snapshot,
		});

		expect(repeatedActiveScroll).toBe(activeScroll.snapshot);

		const settled = computeSnapshot({
			rowModel,
			scrollTop: 20,
			viewportHeight: 100,
			mountedOverscanPx: 1000,
			visibilityMetadataPolicy: { type: "caller-managed" },
			isScrollActive: false,
			previous: activeScroll.snapshot,
		});

		expect(settled).not.toBe(activeScroll.snapshot);
		expect(settled.ranges.mounted).toEqual(initial.ranges.mounted);
		expect(settled.ranges.previewVisible).toEqual({ start: 0, end: 2 });
		expect(settled.mountedCells).toBe(initial.mountedCells);
	});

	it("clamps previous ranges during explicit recompute when row count shrinks", () => {
		const initialRowModel = createRowModel(30);
		const initial = computeSnapshot({
			rowModel: initialRowModel,
			scrollTop: 500,
			viewportHeight: 500,
		});
		const updatedRowModel = createRowModel(21);

		expect(initial.ranges.mounted).toEqual({ start: 4, end: 10 });

		const recomputed = recomputeVirtualListSnapshotWithState({
			rowModel: updatedRowModel,
			previous: initial,
			previousState: stateBySnapshot.get(initial),
			buildMountedCells: ({
				rowModel,
				rowRange,
				previousBuild,
				previousCellsByKey,
			}) =>
				buildMountedVirtualGridCellsFromRowModel({
					rowModel: rowModel as FlatLinkRowModel<TestItem>,
					rowRange,
					previousBuild,
					previousCellsByKey,
				}),
		});

		expect(recomputed.snapshot.rowModel.rowCount).toBe(7);
		expect(recomputed.snapshot.ranges.mounted).toEqual({
			start: 4,
			end: 7,
		});
		expect(recomputed.snapshot.ranges.previewVisible).toEqual({
			start: 4,
			end: 7,
		});
		expect(
			recomputed.snapshot.mountedCells.every(
				(cell) => cell.position.row < updatedRowModel.rowCount,
			),
		).toBe(true);
		expect(recomputed.measurementKind).toBe("stable");
	});

	it("returns an explicit empty snapshot when row count is zero", () => {
		const rowModel = createRowModel(0);
		const result = computeComputation({
			rowModel,
			scrollTop: 0,
		});

		expect(result.snapshot.mode).toEqual({
			kind: "empty",
			reason: "no-rows",
		});
		expect(result.snapshot.ranges).toEqual({
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		});
		expect(result.snapshot.mountedCells).toEqual([]);
		expect(result.snapshot.mountedCellsByKey.size).toBe(0);
		expect(result.reconciliationState.mountedBuild).toBeNull();
		expect(result.measurementKind).toBe("stable");
	});

	it("resets slot lifecycle when transitioning through empty", () => {
		const rowModel = createRowModel(6);
		const initial = computeSnapshot({
			rowModel,
			scrollTop: 0,
		});
		const emptyRowModel = createRowModel(0);
		const empty = computeComputation({
			rowModel: emptyRowModel,
			scrollTop: 0,
			previous: initial,
		});
		const restored = computeComputation({
			rowModel,
			scrollTop: 0,
			previous: empty.snapshot,
		});

		expect(initial.mountedCells[0]?.renderSlotIndex).toBe(0);
		expect(empty.reconciliationState.mountedBuild).toBeNull();
		expect(restored.snapshot.mode.kind).toBe("stable");
		expect(restored.snapshot.mountedCells[0]?.renderSlotIndex).toBe(0);
		expect(restored.reconciliationState.mountedBuild?.nextRenderSlotIndex).toBe(
			stateBySnapshot.get(initial)?.mountedBuild?.nextRenderSlotIndex,
		);
	});
});
