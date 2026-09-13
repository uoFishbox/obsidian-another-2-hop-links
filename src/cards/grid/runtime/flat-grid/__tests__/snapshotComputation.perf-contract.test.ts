import { describe, expect, it, vi } from "vitest";
import { createFlatGridCellSource } from "../cellSource";
import {
	computeFlatGridLayout,
	createResidentRowSlotAllocator,
} from "cards/virtualization/public";
import type { FlatGridLogicalCell } from "../logicalCell";
import { buildMountedFlatGridRows, type MountedFlatGridBuild } from "../mountedRows";
import { flattenMountedRowBindings } from "./mountedRowsTestHelpers";
import { createFlatGridRowModel, type FlatGridRowModel } from "../rowModel";
import {
	computeHarnessSnapshot,
	createHarnessRowModel,
	getHarnessMountedCells,
} from "./snapshotComputationTestHarness";
import {
	createVirtualizerEngine,
	type VirtualListSnapshot,
} from "cards/virtualization/engine/virtualizer";

type TestItem = { id: string };
type TestSnapshot = VirtualListSnapshot<
	FlatGridLogicalCell<TestItem>,
	MountedFlatGridBuild<TestItem>
>;

// Keep this matrix aligned with PERFORMANCE.md. The viewport stays fixed so a
// card-count increase cannot hide mounted-range growth.
const CARD_COUNTS = [100, 1_000, 10_000] as const;
const NO_OP_MEASUREMENTS = 300;
const VIEWPORT_HEIGHT = 600;
// The row stride is 132px. Two overscan rows on each side make the expected
// mounted range five visible rows plus four overscan rows.
const MOUNTED_OVERSCAN_PX = 264;
// Measure away from list edges so both the leading and trailing overscan apply.
const SCROLL_TOP = 1_320;

const getRangeLength = (range: { start: number; end: number }): number =>
	range.end - range.start;

const createRowModel = (cardCount: number): FlatGridRowModel<TestItem> => {
	const items = Array.from({ length: cardCount }, (_, index) => ({
		id: `item-${index}`,
	}));
	const cellSource = createFlatGridCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getItemId: (item) => item.id,
		sectionId: "virtual-list-engine-perf",
	});
	const layout = computeFlatGridLayout({
		containerWidth: 640,
		minCellWidth: 200,
		gap: 12,
		maxColumns: 3,
		rowHeight: 120,
		cellCount: cellSource.cellCount,
	});

	return createFlatGridRowModel({ cellSource, layout });
};

const measureWorkload = (cardCount: number) => {
	const rowModel = createRowModel(cardCount);
	let previous: TestSnapshot | null = null;
	let mountedCellBuilds = 0;
	let fastPathReuses = 0;
	const engine = createVirtualizerEngine<
		FlatGridLogicalCell<TestItem>,
		FlatGridRowModel<TestItem>,
		MountedFlatGridBuild<TestItem>
	>({
		buildMountedRows: ({
			rowModel: nextRowModel,
			rowRange,
			previousBuild,
			rowSlotAllocator,
		}) => {
			mountedCellBuilds += 1;
			return buildMountedFlatGridRows({
				rowModel: nextRowModel,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			});
		},
	});

	// Count reconciliation builds separately from snapshot computations. Every
	// replay computes a snapshot, but no-op replays must take the fast path.
	const applyMeasurement = (): void => {
		engine.applyRangeMeasurement(
			{
				scrollTop: SCROLL_TOP,
				viewportHeight: VIEWPORT_HEIGHT,
				sectionTop: 0,
				hasValidScrollMetrics: true,
				isScrollActive: false,
				scrollGeneration: 0,
				source: "scroll",
			},
			rowModel,
			{
				bootstrapRows: 3,
				mountedOverscanPx: MOUNTED_OVERSCAN_PX,
			},
		);
		const snapshot = engine.getSnapshot();

		if (snapshot === previous) {
			fastPathReuses += 1;
		}
		previous = snapshot;
	};

	// Prime the mounted build once, then replay a sustained no-op workload.
	applyMeasurement();
	for (let index = 0; index < NO_OP_MEASUREMENTS; index += 1) {
		applyMeasurement();
	}

	const snapshot = previous as TestSnapshot | null;
	expect(snapshot).not.toBeNull();
	if (!snapshot) {
		throw new Error("Expected a virtual-list snapshot.");
	}
	const mountedCells = snapshot.mountedBuild
		? flattenMountedRowBindings(snapshot.mountedBuild.rowsInMountedRange)
		: [];

	return {
		cardCount,
		viewportRows: getRangeLength(snapshot.ranges.previewVisible),
		mountedRows: getRangeLength(snapshot.ranges.mounted),
		mountedCells: mountedCells.length,
		mountedCellBuilds,
		fastPathReuses,
		uniqueRenderSlots: new Set(mountedCells.map((cell) => cell.physicalCellSlot))
			.size,
	};
};

describe("VirtualListEngine performance contracts", () => {
	it("bounds mounted work by the viewport range instead of total card count", () => {
		const measurements = CARD_COUNTS.map(measureWorkload);

		// Three columns across nine mounted rows yields 27 cells regardless of
		// the total logical card count.
		expect(measurements).toEqual(
			CARD_COUNTS.map((cardCount) => ({
				cardCount,
				viewportRows: 5,
				mountedRows: 9,
				mountedCells: 27,
				mountedCellBuilds: 1,
				fastPathReuses: NO_OP_MEASUREMENTS,
				uniqueRenderSlots: 27,
			})),
		);
	});

	it("resolves only the entering flat-grid row across sustained scrolling", () => {
		const rowModel = createRowModel(10_000);
		const getRow = vi.spyOn(rowModel, "getRow");
		const rowSlotAllocator = createResidentRowSlotAllocator();
		let mounted = buildMountedFlatGridRows({
			rowModel,
			rowRange: { start: 10, end: 19 },
			rowSlotAllocator,
		});
		const mountedRows = mounted.rowsInMountedRange.length;
		for (let frame = 1; frame <= NO_OP_MEASUREMENTS; frame += 1) {
			mounted = buildMountedFlatGridRows({
				rowModel,
				rowRange: {
					start: 10 + frame,
					end: 19 + frame,
				},
				previousBuild: mounted,
				rowSlotAllocator,
			});
		}

		expect(mounted.rowsInMountedRange).toHaveLength(mountedRows);
		expect(getRow).toHaveBeenCalledTimes(mountedRows + NO_OP_MEASUREMENTS);
	});
});

// The remaining contracts cover the engine's reuse fast paths. They assert
// object identity and builder call counts on purpose: PERFORMANCE.md lists
// snapshot/build reuse, physical slot stability, and the canonical mounted
// build shape as Required Invariants, so a failure here means the performance
// implementation changed rather than that user-visible behaviour broke.
describe("VirtualListEngine reuse contracts", () => {
	it("keeps render slots unique and reuses physical slots while scrolling", () => {
		const rowModel = createHarnessRowModel(12);
		const initial = computeHarnessSnapshot({ rowModel }).snapshot;
		const shifted = computeHarnessSnapshot({
			rowModel,
			previous: initial,
			scrollTop: 110,
		}).snapshot;
		const initialCells = getHarnessMountedCells(initial.mountedBuild!);
		const shiftedCells = getHarnessMountedCells(shifted.mountedBuild!);

		// Slots are claimed from a resident pool, so the same slot numbers stay in
		// use and each is assigned at most once.
		expect(shiftedCells.map((cell) => cell.physicalCellSlot)).toEqual(
			initialCells.map((cell) => cell.physicalCellSlot),
		);
		expect(new Set(shiftedCells.map((cell) => cell.physicalCellSlot)).size).toBe(
			shiftedCells.length,
		);
	});

	it("publishes no visibility metadata or mounted-cell key index", () => {
		const snapshot = computeHarnessSnapshot({
			rowModel: createHarnessRowModel(12),
			mountedOverscanPx: 220,
		}).snapshot;

		// The mounted build is the canonical representation; adding a flat key
		// index or per-cell visibility flag would duplicate it.
		expect("mountedCellsByKey" in snapshot).toBe(false);
		expect(
			getHarnessMountedCells(snapshot.mountedBuild!).every(
				(cell) => !Object.prototype.hasOwnProperty.call(cell, "visibility"),
			),
		).toBe(true);
	});

	it("reuses the mounted build when only previewVisible changes", () => {
		const rowModel = createHarnessRowModel(30);
		const buildMountedRows = vi.fn(buildMountedFlatGridRows<TestItem>);
		const initialResult = computeHarnessSnapshot({
			rowModel,
			ranges: {
				mounted: { start: 0, end: 7 },
				previewVisible: { start: 0, end: 1 },
			},
			buildMountedRows,
		});
		const nextResult = computeHarnessSnapshot({
			rowModel,
			previous: initialResult.snapshot,
			ranges: {
				mounted: { start: 0, end: 7 },
				previewVisible: { start: 1, end: 2 },
			},
			buildMountedRows,
		});

		expect(buildMountedRows).toHaveBeenCalledTimes(1);
		expect(nextResult.snapshot.mountedBuild).toBe(
			initialResult.snapshot.mountedBuild,
		);
	});

	it("reuses the entire snapshot for a no-op measurement", () => {
		const rowModel = createHarnessRowModel(30);
		const ranges = {
			mounted: { start: 0, end: 4 },
			previewVisible: { start: 0, end: 1 },
		};
		const initial = computeHarnessSnapshot({ rowModel, ranges }).snapshot;
		const repeated = computeHarnessSnapshot({
			rowModel,
			previous: initial,
			ranges,
		}).snapshot;

		expect(repeated).toBe(initial);
	});

	it("recomputes into the same mounted build when dependencies are unchanged", () => {
		const rowModel = createHarnessRowModel(12);
		const buildMountedRows = vi.fn(buildMountedFlatGridRows<TestItem>);
		const initialResult = computeHarnessSnapshot({ rowModel, buildMountedRows });
		buildMountedRows.mockClear();
		initialResult.engine.recompute({ rowModel });
		const recomputed = initialResult.engine.getSnapshot();

		expect(buildMountedRows).not.toHaveBeenCalled();
		expect(recomputed?.mountedBuild).toBe(initialResult.snapshot.mountedBuild);
	});
});
