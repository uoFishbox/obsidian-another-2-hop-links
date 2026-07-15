import { describe, expect, it } from "vitest";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import { compileTwoHopViewPlan, createTwoHopViewPlanRowModel } from "../twoHopViewPlan";
import { createTwoHopScalarScrollKernel } from "../twoHopScalarScrollKernel.svelte";
import { createTwoHopFixedRowSlotPool } from "../twoHopFixedRowSlotPool.svelte";
import { createSurfaceVirtualCellRegistry } from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";

const items = Array.from({ length: 1_000 }, (_, index) => ({
	kind: "new-link" as const,
	item: { type: "link" } as never,
	searchKey: `item-${index}`,
	virtualKey: `item-${index}`,
}));

const section = {
	kind: "new-links-section",
	rawSectionId: "new-links",
	sectionId: "new-links",
	sectionKey: "new-links",
	title: "New links",
	getKey: () => "",
} satisfies TwoHopVirtualListSection;

const descriptor: SectionRenderDescriptor<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
> = {
	section,
	sectionKey: section.sectionKey,
	title: section.title,
	sectionId: section.sectionId,
	totalCount: items.length,
	loadedCount: items.length,
	getItems: () => items,
	headerProps: {},
};

const rowModel = createTwoHopViewPlanRowModel(
	compileTwoHopViewPlan({
		sections: [descriptor],
		sectionVisibleCounts: { "new-links": items.length },
		layout: {
			containerWidth: 220,
			columns: 2,
			cellWidth: 100,
			rowHeight: 100,
			gap: 10,
			sectionMarginBottom: 20,
		},
		resolveInitialSectionVisibleCount: () => items.length,
		clampVisibleCount: (_current, count) => count,
	}),
);

const sparseItems: TwoHopVirtualListItem[] = [];
sparseItems.length = 3;
sparseItems[0] = items[0];
sparseItems[2] = items[2];
const sparseDescriptor: SectionRenderDescriptor<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
> = {
	...descriptor,
	totalCount: 4,
	loadedCount: 4,
	getItems: () => sparseItems,
};
const sparsePlan = compileTwoHopViewPlan({
	sections: [sparseDescriptor],
	sectionVisibleCounts: { "new-links": 3 },
	layout: {
		containerWidth: 220,
		columns: 2,
		cellWidth: 100,
		rowHeight: 100,
		gap: 10,
		sectionMarginBottom: 20,
	},
	resolveInitialSectionVisibleCount: () => 3,
	clampVisibleCount: (_current, count) => count,
});
const sparseRowModel = createTwoHopViewPlanRowModel(sparsePlan);
const malformedCells = [...sparsePlan.cells];
malformedCells.pop();
const malformedRowModel = createTwoHopViewPlanRowModel({
	...sparsePlan,
	cells: malformedCells,
});

function applyModelRange(
	kernel: ReturnType<typeof createTwoHopScalarScrollKernel>,
	targetRowModel: ReturnType<typeof createTwoHopViewPlanRowModel>,
	start: number,
	mountedRowCount: number,
): void {
	kernel.applyMeasurement({
		rowModel: targetRowModel,
		scrollTop: 0,
		viewportHeight: 100,
		sectionTop: 0,
		isStableMeasurement: true,
		isScrollActive: true,
		hasStableVisibleRange: true,
		precomputedRanges: {
			mounted: { start, end: start + mountedRowCount },
			previewVisible: {
				start: start + 1,
				end: Math.min(start + 2, start + mountedRowCount),
			},
		},
		visibilityPolicy: {
			bootstrapRows: 1,
			mountedOverscanPx: 0,
		},
	});
}

function applyRange(
	kernel: ReturnType<typeof createTwoHopScalarScrollKernel>,
	start: number,
	mountedRowCount = 3,
): void {
	applyModelRange(kernel, rowModel, start, mountedRowCount);
}

describe("TwoHop scalar scroll kernel", () => {
	it("mounts every declared slot for sparse items and load-more", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: sparseRowModel,
			onStableVisibleRange() {},
		});

		applyModelRange(kernel, sparseRowModel, 0, 2);

		expect(kernel.mountedRows).toHaveLength(2);
		expect(kernel.mountedRows.map((row) => row.cells.length)).toEqual([2, 2]);
		expect(
			kernel.mountedRows.flatMap((row) =>
				row.cells.map((cell) => cell.cell.kind),
			),
		).toEqual(["header", "item", "item", "load-more"]);
		expect(
			kernel.fixedRowSlotPool.controllers.map(
				(controller) => controller.cells.filter((cell) => cell.active).length,
			),
		).toEqual([2, 2]);

		kernel.dispose();
	});

	it("clears and later rebinds a physical cell slot when a row contains a hole", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0, 1);
		const fullRow = kernel.mountedRows[0];
		const firstCell = fullRow?.cells[0];
		expect(fullRow?.cells).toHaveLength(2);
		expect(firstCell).toBeDefined();
		if (!fullRow || !firstCell) return;

		const pool = createTwoHopFixedRowSlotPool();
		pool.bindRow(fullRow);
		expect(pool.controllers[0]?.cells.map((cell) => cell.active)).toEqual([
			true,
			true,
		]);

		const cellsWithHole = [firstCell];
		cellsWithHole.length = 2;
		pool.bindRow({ ...fullRow, cells: cellsWithHole });
		expect(pool.controllers[0]?.cells.map((cell) => cell.active)).toEqual([
			true,
			false,
		]);

		pool.bindRow(fullRow);
		expect(pool.controllers[0]?.cells.map((cell) => cell.active)).toEqual([
			true,
			true,
		]);

		kernel.dispose();
	});

	it("creates every cell slot before a short row is recycled", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0, 1);
		const fullRow = kernel.mountedRows[0];
		const firstCell = fullRow?.cells[0];
		expect(fullRow?.cells).toHaveLength(2);
		expect(firstCell).toBeDefined();
		if (!fullRow || !firstCell) return;

		const pool = createTwoHopFixedRowSlotPool();
		pool.setCapacity(1, 2);
		const secondSlot = pool.controllers[0]?.cells[1];
		pool.bindRow({ ...fullRow, cells: [firstCell] });

		expect(pool.controllers[0]?.cells).toHaveLength(2);
		expect(pool.controllers[0]?.cells[1]).toBe(secondSlot);
		expect(secondSlot?.active).toBe(false);

		pool.bindRow(fullRow);
		expect(pool.controllers[0]?.cells[1]).toBe(secondSlot);
		expect(secondSlot?.active).toBe(true);

		kernel.dispose();
	});

	it("does not leave a partially bound row when its compiled slot is missing", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: malformedRowModel,
			onStableVisibleRange() {},
		});

		applyModelRange(kernel, malformedRowModel, 0, 2);

		expect(kernel.mountedRows[0]?.cells).toHaveLength(2);
		expect(kernel.fixedRowSlotPool.controllers[0]?.active).toBe(true);
		expect(kernel.mountedRows[1]?.cells).toHaveLength(0);
		expect(kernel.fixedRowSlotPool.controllers[1]?.active).toBe(false);

		kernel.dispose();
	});

	it("updates the surface navigation index inside the slot bind transaction", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		const registry = createSurfaceVirtualCellRegistry();
		const element = document.createElement("div");
		applyRange(kernel, 0);
		const cellController = kernel.fixedRowSlotPool.controllers[0]?.cells[0];
		expect(cellController).toBeDefined();
		if (!cellController) return;

		cellController.attachElement(element, registry);
		const previousKey = String(cellController.logicalKey);
		expect(registry.findByKey(previousKey)).toBe(element);

		applyRange(kernel, 1);
		const nextKey = String(cellController.logicalKey);
		expect(nextKey).not.toBe(previousKey);
		expect(registry.findByKey(previousKey)).toBeNull();
		expect(registry.findByKey(nextKey)).toBe(element);

		kernel.dispose();
		expect(registry.findByKey(nextKey)).toBeNull();
	});

	it("stores preview visibility on each physical cell controller", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0);

		expect(
			kernel.fixedRowSlotPool.controllers.map(
				(row) => row.cells[0]?.visibilityState.visibility,
			),
		).toEqual(["mounted", "visible", "mounted"]);

		kernel.syncPreviewVisibleRange(2, 3);

		expect(
			kernel.fixedRowSlotPool.controllers.map(
				(row) => row.cells[0]?.visibilityState.visibility,
			),
		).toEqual(["mounted", "mounted", "visible"]);

		kernel.dispose();
	});

	it("reuses row/cell shells and writes only the entering slot", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0);
		const mountedRows = kernel.mountedRows;
		const recycledRowShell = mountedRows[0];
		const recycledCellShells = [...recycledRowShell.cells];
		const controllers = kernel.fixedRowSlotPool.controllers;
		const recycledControllerCells = controllers[0]?.cells;

		resetCCLDevMeasurements();
		applyRange(kernel, 1);

		expect(kernel.mountedRows).toBe(mountedRows);
		expect(kernel.fixedRowSlotPool.controllers).toBe(controllers);
		expect(controllers[0]?.cells).toBe(recycledControllerCells);
		expect(mountedRows[0]).toBe(recycledRowShell);
		expect(mountedRows[0]?.rowIndex).toBe(3);
		expect(mountedRows[0]?.cells[0]).toBe(recycledCellShells[0]);
		expect(mountedRows[0]?.cells[1]).toBe(recycledCellShells[1]);

		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.scalarKernel.rowShellCreated"].count).toBe(0);
		expect(counters["twoHop.scalarKernel.cellShellCreated"].count).toBe(0);
		expect(counters["twoHop.reboundRowSlot"].count).toBe(1);
		expect(counters["twoHop.reboundCellSlot"].count).toBe(2);
		expect(counters["twoHop.fixedSlotPool.cellCapacityCheck"].count).toBe(1);
		expect(counters["twoHop.buildMountedRows"].count).toBe(0);
	});

	it("performs no slot work for an unchanged range", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 5);
		resetCCLDevMeasurements();

		applyRange(kernel, 5);

		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.scalarKernel.mountedRangeCommit"].count).toBe(0);
		expect(counters["twoHop.reboundRowSlot"].count).toBe(0);
		expect(counters["twoHop.reboundCellSlot"].count).toBe(0);
	});

	it("crosses 300 boundaries without allocating new row or cell shells", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0);
		const mountedRows = kernel.mountedRows;
		const rowShells = [...mountedRows];
		const cellShells = mountedRows.map((row) => [...row.cells]);
		resetCCLDevMeasurements();

		for (let frame = 1; frame <= 300; frame += 1) {
			applyRange(kernel, frame);
		}

		expect(kernel.mountedRows).toBe(mountedRows);
		for (let slotIndex = 0; slotIndex < rowShells.length; slotIndex += 1) {
			expect(mountedRows[slotIndex]).toBe(rowShells[slotIndex]);
			expect(mountedRows[slotIndex]?.cells[0]).toBe(cellShells[slotIndex]?.[0]);
			expect(mountedRows[slotIndex]?.cells[1]).toBe(cellShells[slotIndex]?.[1]);
		}
		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.scalarKernel.rowShellCreated"].count).toBe(0);
		expect(counters["twoHop.scalarKernel.cellShellCreated"].count).toBe(0);
		expect(counters["twoHop.reboundRowSlot"].count).toBe(300);
		expect(counters["twoHop.reboundCellSlot"].count).toBe(600);
		expect(counters["twoHop.buildMountedRows"].count).toBe(0);
	});

	it("rebinds the full range when capacity growth changes slot mapping", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 10, 3);
		resetCCLDevMeasurements();

		applyRange(kernel, 10, 4);

		const mountedRowIndexes = kernel.mountedRows
			.map((row) => row.rowIndex)
			.sort((left, right) => left - right);
		expect(mountedRowIndexes).toEqual([10, 11, 12, 13]);
		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.reboundRowSlot"].count).toBe(4);
		expect(counters["twoHop.reboundCellSlot"].count).toBe(8);
	});

	it("compacts physical row slots after sustained under-utilization", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0, 12);

		applyRange(kernel, 9, 3);
		applyRange(kernel, 9, 3);
		applyRange(kernel, 9, 3);

		expect(kernel.mountedRows).toHaveLength(3);
		expect(kernel.fixedRowSlotPool.controllers).toHaveLength(3);
		expect(
			kernel.mountedRows
				.map((row) => row.rowIndex)
				.sort((left, right) => left - right),
		).toEqual([9, 10, 11]);
	});
});
