import { describe, expect, it, vi } from "vitest";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import { createFlatLogicalCellSource } from "../../flatLogicalCellSource";
import { computeVirtualGridLayout } from "../../layout/flatGridLayout";
import type { VirtualListLogicalCell } from "../../logicalCell";
import {
	buildMountedVirtualGridCellsFromRowModel,
	type MountedVirtualGridCell,
	type MountedVirtualGridCellsBuildResult,
} from "../reconciliation/linkListVirtualLayout";
import {
	createFlatLinkRowModel,
	type FlatLinkRowModel,
} from "../../row-models/flatLinkRowModel";
import {
	computeVirtualListSnapshotWithState,
	type VirtualListReconciliationState,
	type VirtualListSnapshot,
} from "../virtualListEngine";

type TestItem = { id: string };
type TestSnapshot = VirtualListSnapshot<
	VirtualListLogicalCell<TestItem>,
	MountedVirtualGridCell<TestItem>,
	MountedVirtualGridCellsBuildResult<TestItem>
>;
type TestReconciliationState = VirtualListReconciliationState<
	MountedVirtualGridCellsBuildResult<TestItem>
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

const createRowModel = (cardCount: number): FlatLinkRowModel<TestItem> => {
	const items = Array.from({ length: cardCount }, (_, index) => ({
		id: `item-${index}`,
	}));
	const cellSource = createFlatLogicalCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getKey: (item) => item.id,
		sectionId: "virtual-list-engine-perf",
	});
	const layout = computeVirtualGridLayout({
		containerWidth: 640,
		minCellWidth: 200,
		gap: 12,
		maxColumns: 3,
		rowHeight: 120,
		cellCount: cellSource.cellCount,
	});

	return createFlatLinkRowModel({ cellSource, layout });
};

const measureWorkload = (cardCount: number) => {
	const rowModel = createRowModel(cardCount);
	let previous: TestSnapshot | null = null;
	let previousState: TestReconciliationState | null = null;
	let mountedCellBuilds = 0;
	let fastPathReuses = 0;

	// Count reconciliation builds separately from snapshot computations. Every
	// replay computes a snapshot, but no-op replays must take the fast path.
	const applyMeasurement = (): void => {
		const result = computeVirtualListSnapshotWithState<
			VirtualListLogicalCell<TestItem>,
			MountedVirtualGridCell<TestItem>,
			MountedVirtualGridCellsBuildResult<TestItem>
		>({
			rowModel,
			measurement: {
				scrollTop: SCROLL_TOP,
				viewportHeight: VIEWPORT_HEIGHT,
				sectionTop: 0,
				isStableMeasurement: true,
				hasStableVisibleRange: previous !== null,
				currentMountedRange: previous?.ranges.mounted ?? {
					start: 0,
					end: 0,
				},
			},
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: MOUNTED_OVERSCAN_PX,
			},
			previous,
			previousState,
			buildMountedCells: ({
				rowModel: nextRowModel,
				rowRange,
				previousBuild,
				previousCellsByKey,
			}) => {
				mountedCellBuilds += 1;
				return buildMountedVirtualGridCellsFromRowModel({
					rowModel: nextRowModel as FlatLinkRowModel<TestItem>,
					rowRange,
					previousBuild,
					previousCellsByKey,
				});
			},
		});

		if (result.snapshot === previous) {
			fastPathReuses += 1;
		}
		previous = result.snapshot;
		previousState = result.reconciliationState;
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

	return {
		cardCount,
		viewportRows: getRangeLength(snapshot.ranges.previewVisible),
		mountedRows: getRangeLength(snapshot.ranges.mounted),
		mountedCells: snapshot.mountedCells.length,
		mountedCellBuilds,
		fastPathReuses,
		uniqueRenderSlots: new Set(
			snapshot.mountedCells.map((cell) => cell.renderSlotIndex),
		).size,
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
		const resolveCellAtIndex = vi.spyOn(rowModel, "resolveCellAtIndex");
		let mounted = buildMountedVirtualGridCellsFromRowModel({
			rowModel,
			rowRange: { start: 10, end: 19 },
		});
		const mountedRows = mounted.rowSlices.length;
		const columns = rowModel.layout.columns;

		resetCCLDevMeasurements();
		for (let frame = 1; frame <= NO_OP_MEASUREMENTS; frame += 1) {
			mounted = buildMountedVirtualGridCellsFromRowModel({
				rowModel,
				rowRange: {
					start: 10 + frame,
					end: 19 + frame,
				},
				previousBuild: mounted,
			});
		}

		expect(mounted.rowSlices).toHaveLength(mountedRows);
		expect(resolveCellAtIndex).toHaveBeenCalledTimes(
			mountedRows * columns + NO_OP_MEASUREMENTS * columns,
		);
		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["virtualGrid.buildMountedRows"].count).toBe(NO_OP_MEASUREMENTS);
		expect(counters["virtualGrid.contiguousSlotPool.apply"].count).toBe(
			NO_OP_MEASUREMENTS,
		);
		expect(counters["virtualGrid.rowShellCreated"].count).toBe(NO_OP_MEASUREMENTS);
		expect(counters["virtualGrid.cellShellCreated"].count).toBe(
			NO_OP_MEASUREMENTS * columns,
		);
	});
});
