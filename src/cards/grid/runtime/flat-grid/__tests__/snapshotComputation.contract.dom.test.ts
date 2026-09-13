import { describe, expect, it } from "vitest";
import { computeFlatGridLayout } from "cards/virtualization/public";
import { createFlatGridRowModel } from "../rowModel";
import {
	computeHarnessSnapshot,
	createHarnessRowModel,
	getHarnessMountedCells,
} from "./snapshotComputationTestHarness";
import { expectUniquePhysicalCellSlots } from "./mountedRowsTestHelpers";

describe("VirtualListEngine contract", () => {
	it("mounts only the viewport rows plus the mounted overscan", () => {
		const snapshot = computeHarnessSnapshot({
			rowModel: createHarnessRowModel(12),
			mountedOverscanPx: 220,
		}).snapshot;

		expect(snapshot.ranges.mounted).toEqual({ start: 0, end: 3 });
		expect(snapshot.mountedBuild).not.toBeNull();
	});

	it("never assigns one physical cell slot twice in a snapshot", () => {
		const snapshot = computeHarnessSnapshot({
			rowModel: createHarnessRowModel(12),
			mountedOverscanPx: 220,
		}).snapshot;
		const cells = getHarnessMountedCells(snapshot.mountedBuild!);

		expect(cells.length).toBeGreaterThan(0);
		expectUniquePhysicalCellSlots(cells);
	});

	it("publishes frozen snapshot and range objects", () => {
		const snapshot = computeHarnessSnapshot({
			rowModel: createHarnessRowModel(12),
		}).snapshot;

		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.ranges)).toBe(true);
		expect(Object.isFrozen(snapshot.ranges.mounted)).toBe(true);
		expect(Object.isFrozen(snapshot.ranges.previewVisible)).toBe(true);
	});

	it("rebuilds when a new row model instance is published", () => {
		const rowModel = createHarnessRowModel(30);
		const replacementRowModel = createFlatGridRowModel({
			cellSource: rowModel.cellSource,
			layout: computeFlatGridLayout({
				containerWidth: 320,
				minCellWidth: 100,
				gap: 10,
				maxColumns: 3,
				rowHeight: 100,
				cellCount: rowModel.cellSource.cellCount,
			}),
		});
		const ranges = {
			mounted: { start: 0, end: 4 },
			previewVisible: { start: 0, end: 1 },
		};
		const initial = computeHarnessSnapshot({ rowModel, ranges }).snapshot;
		const replaced = computeHarnessSnapshot({
			rowModel: replacementRowModel,
			previous: initial,
			ranges,
		}).snapshot;

		expect(replaced.rowModel).toBe(replacementRowModel);
		expect(replaced.mountedBuild).not.toBe(initial.mountedBuild);
	});

	it("mounts different rows after the mounted range moves", () => {
		const rowModel = createHarnessRowModel(30);
		const initial = computeHarnessSnapshot({
			rowModel,
			ranges: {
				mounted: { start: 0, end: 3 },
				previewVisible: { start: 0, end: 1 },
			},
		}).snapshot;
		const shifted = computeHarnessSnapshot({
			rowModel,
			previous: initial,
			ranges: {
				mounted: { start: 1, end: 4 },
				previewVisible: { start: 1, end: 2 },
			},
		}).snapshot;
		const initialKeys = new Set(
			getHarnessMountedCells(initial.mountedBuild!).map((cell) => cell.key),
		);
		const shiftedCells = getHarnessMountedCells(shifted.mountedBuild!);

		expect(shiftedCells.length).toBeGreaterThan(0);
		// The mounted set has to follow the range, so at least one row is new.
		expect(shiftedCells.some((cell) => !initialKeys.has(cell.key))).toBe(true);
		expect(shifted.mountedBuild).not.toBe(initial.mountedBuild);
	});

	it("reuses the mounted build when only previewVisible changes", () => {
		const rowModel = createHarnessRowModel(30);
		const initialResult = computeHarnessSnapshot({
			rowModel,
			ranges: {
				mounted: { start: 0, end: 7 },
				previewVisible: { start: 0, end: 1 },
			},
		});
		const nextResult = computeHarnessSnapshot({
			rowModel,
			previous: initialResult.snapshot,
			ranges: {
				mounted: { start: 0, end: 7 },
				previewVisible: { start: 1, end: 2 },
			},
		});

		expect(nextResult.snapshot).not.toBe(initialResult.snapshot);
		expect(nextResult.snapshot.ranges.previewVisible).toEqual({ start: 1, end: 2 });
		expect(nextResult.snapshot.mountedBuild).toBe(
			initialResult.snapshot.mountedBuild,
		);
	});

	it("returns an empty snapshot when the row model has no rows", () => {
		const result = computeHarnessSnapshot({ rowModel: createHarnessRowModel(0) });

		expect(result.snapshot.mountedBuild).toBeNull();
		expect(result.snapshot.ranges).toEqual({
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		});
	});
});
