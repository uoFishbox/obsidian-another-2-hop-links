import { describe, expect, it, vi } from "vitest";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import { compileTwoHopViewPlan, createTwoHopViewPlanRowModel } from "../twoHopViewPlan";
import { createTwoHopScalarScrollKernel } from "../twoHopScalarScrollKernel.svelte";
import { createTwoHopFixedRowSlotPool } from "../twoHopFixedRowSlotPool.svelte";
import { createSurfaceVirtualCellRegistry } from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
import { VIRTUAL_CELL_WILL_REBIND_EVENT } from "ui/interactions/virtualCellRebind";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";
import { createTwoHopCellBinding, type TwoHopCellBinding } from "../twoHopCellBinding";

const items = Array.from({ length: 1_000 }, (_, index) => ({
	kind: "new-link" as const,
	item: { type: "link" } as never,
	interactionId: `item:test:${index}`,
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

function getActiveRows(
	kernel: ReturnType<typeof createTwoHopScalarScrollKernel>,
) {
	return kernel.mountedRows.filter((row) => row.cells.length > 0);
}

function getMountedRow(
	kernel: ReturnType<typeof createTwoHopScalarScrollKernel>,
	rowIndex: number,
) {
	return kernel.mountedRows.find(
		(row) => row.rowIndex === rowIndex && row.cells.length > 0,
	);
}

describe("TwoHop scalar scroll kernel", () => {
	it("reads only render snapshot fields while creating a cell binding", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0);
		const sourceCell = kernel.mountedRows[0]?.cells[0];
		expect(sourceCell).toBeDefined();
		if (!sourceCell) return;
		const logicalKeyGetter = vi.spyOn(sourceCell, "logicalKey", "get");
		const renderSlotKeyGetter = vi.spyOn(sourceCell, "renderSlotKey", "get");
		const rowTopGetter = vi.spyOn(sourceCell, "rowTop", "get");
		const renderRevisionGetter = vi.spyOn(sourceCell, "renderBodyRevision", "get");

		const binding = createTwoHopCellBinding(sourceCell, 1);

		expect(binding.logicalKey).toBe(sourceCell.key);
		expect(logicalKeyGetter).not.toHaveBeenCalled();
		expect(renderSlotKeyGetter).not.toHaveBeenCalled();
		expect(rowTopGetter).not.toHaveBeenCalled();
		expect(renderRevisionGetter).not.toHaveBeenCalled();

		kernel.dispose();
	});

	it("keeps the mounted interaction index synchronized across slot rebind and clear", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});

		applyRange(kernel, 0, 1);

		expect(kernel.getMountedCellByInteractionId("new-links")?.cell.kind).toBe(
			"header",
		);
		expect(kernel.getMountedCellByInteractionId("item:test:0")?.cell.kind).toBe(
			"item",
		);

		applyRange(kernel, 3, 1);

		expect(kernel.getMountedCellByInteractionId("new-links")).toBeUndefined();
		expect(kernel.getMountedCellByInteractionId("item:test:0")).toBeUndefined();
		const reboundItem = getMountedRow(kernel, 3)?.cells.find(
			(cell) => cell.cell.kind === "item",
		);
		if (reboundItem?.cell.kind !== "item") return;
		const reboundInteractionId = reboundItem.cell.item.interactionId;
		expect(reboundInteractionId).toBeDefined();
		if (!reboundInteractionId) return;
		expect(kernel.getMountedCellByInteractionId(reboundInteractionId)).toBe(
			reboundItem,
		);

		kernel.dispose();
		expect(
			kernel.getMountedCellByInteractionId(reboundInteractionId),
		).toBeUndefined();
	});

	it("mounts every declared slot for sparse items and load-more", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: sparseRowModel,
			onStableVisibleRange() {},
		});

		applyModelRange(kernel, sparseRowModel, 0, 2);
		const activeRows = getActiveRows(kernel);

		expect(kernel.mountedRows).toHaveLength(5);
		expect(activeRows).toHaveLength(2);
		expect(activeRows.map((row) => row.cells.length)).toEqual([2, 2]);
		expect(
			activeRows.flatMap((row) =>
				row.cells.map((cell) => cell.cell.kind),
			),
		).toEqual(["header", "item", "item", "load-more"]);
		expect(
			kernel.fixedRowSlotPool.controllers
				.filter((controller) => controller.active)
				.map(
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

	it("skips cell-capacity scans when pool dimensions are unchanged", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0, 1);
		const row = kernel.mountedRows[0];
		expect(row).toBeDefined();
		if (!row) return;

		const pool = createTwoHopFixedRowSlotPool();
		pool.setCapacity(3, 2);
		const setCellCapacitySpies = pool.controllers.map((controller) =>
			vi.spyOn(
				controller as typeof controller & {
					setCellCapacity(capacity: number): void;
				},
				"setCellCapacity",
			),
		);

		pool.setCapacity(3, 2);
		for (const setCellCapacitySpy of setCellCapacitySpies) {
			expect(setCellCapacitySpy).not.toHaveBeenCalled();
		}

		pool.bindRow(row);
		expect(setCellCapacitySpies[0]).toHaveBeenCalledOnce();
		expect(setCellCapacitySpies[1]).not.toHaveBeenCalled();
		expect(setCellCapacitySpies[2]).not.toHaveBeenCalled();

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

		applyRange(kernel, 6);
		const nextKey = String(cellController.logicalKey);
		expect(nextKey).not.toBe(previousKey);
		expect(registry.findByKey(previousKey)).toBeNull();
		expect(registry.findByKey(nextKey)).toBe(element);

		kernel.dispose();
		expect(registry.findByKey(nextKey)).toBeNull();
	});

	it("publishes one complete binding after will-rebind", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		const element = document.createElement("div");
		const registry = createSurfaceVirtualCellRegistry();
		applyRange(kernel, 0);
		const controller = kernel.fixedRowSlotPool.controllers[0]?.cells[0];
		expect(controller?.binding).not.toBeNull();
		if (!controller?.binding) return;
		controller.attachElement(element, registry);
		const previousBinding = controller.binding;
		let observedDuringWillRebind: TwoHopCellBinding | null = controller.binding;
		const transientInteraction = document.createElement("div");
		transientInteraction.dataset.cclHovered = "true";
		element.append(transientInteraction);
		element.addEventListener(VIRTUAL_CELL_WILL_REBIND_EVENT, () => {
			observedDuringWillRebind = controller.binding;
		});

		resetCCLDevMeasurements();
		applyRange(kernel, 6);

		const nextBinding = controller.binding;
		expect(observedDuringWillRebind).toBe(previousBinding);
		expect(nextBinding).not.toBe(previousBinding);
		expect(nextBinding?.logicalKey).toBe(nextBinding?.mountedCell.key);
		expect(nextBinding?.rowIndex).toBe(nextBinding?.mountedCell.rowIndex);
		expect(nextBinding?.columnIndex).toBe(nextBinding?.mountedCell.columnIndex);
		expect(nextBinding?.renderKind).toBe(nextBinding?.mountedCell.renderBodyKind);
		expect(
			getCCLDevMeasurementSnapshot().counters["twoHop.binding.commit"].count,
		).toBe(6);

		kernel.dispose();
	});

	it("uses preallocated row and cell shells for the entering slot", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0);
		const mountedRows = kernel.mountedRows;
		const recycledRowShell = mountedRows[3];
		const controllers = kernel.fixedRowSlotPool.controllers;
		const recycledControllerCells = controllers[3]?.cells;
		expect(recycledRowShell?.cells).toHaveLength(0);

		resetCCLDevMeasurements();
		applyRange(kernel, 1);

		expect(kernel.mountedRows).toBe(mountedRows);
		expect(kernel.fixedRowSlotPool.controllers).toBe(controllers);
		expect(controllers[3]?.cells).toBe(recycledControllerCells);
		expect(mountedRows[3]).toBe(recycledRowShell);
		expect(mountedRows[3]?.rowIndex).toBe(3);
		expect(mountedRows[3]?.cells).toHaveLength(2);
		expect(mountedRows[0]?.cells).toHaveLength(0);

		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.scalarKernel.rowShellCreated"].count).toBe(0);
		expect(counters["twoHop.scalarKernel.cellShellCreated"].count).toBe(0);
		expect(counters["twoHop.reboundRowSlot"].count).toBe(1);
		expect(counters["twoHop.reboundCellSlot"].count).toBe(2);
		expect(counters["twoHop.binding.commit"].count).toBe(2);
		expect(counters["twoHop.physicalPool.resize"].count).toBe(0);
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
		expect(counters["twoHop.binding.commit"].count).toBe(0);
	});

	it("crosses 300 boundaries without allocating new row or cell shells", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0);
		const mountedRows = kernel.mountedRows;
		const rowShells = [...mountedRows];
		const controllers = kernel.fixedRowSlotPool.controllers;
		const controllerCellShells = controllers.map((controller) => controller.cells);
		resetCCLDevMeasurements();

		for (let frame = 1; frame <= 300; frame += 1) {
			applyRange(kernel, frame);
		}

		expect(kernel.mountedRows).toBe(mountedRows);
		for (let slotIndex = 0; slotIndex < rowShells.length; slotIndex += 1) {
			expect(mountedRows[slotIndex]).toBe(rowShells[slotIndex]);
			expect(controllers[slotIndex]?.cells).toBe(
				controllerCellShells[slotIndex],
			);
		}
		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.scalarKernel.rowShellCreated"].count).toBe(0);
		expect(counters["twoHop.scalarKernel.cellShellCreated"].count).toBe(0);
		expect(counters["twoHop.reboundRowSlot"].count).toBe(300);
		expect(counters["twoHop.reboundCellSlot"].count).toBe(600);
		expect(counters["twoHop.binding.commit"].count).toBe(600);
		expect(counters["twoHop.buildMountedRows"].count).toBe(0);
	});

	it("uses capacity headroom before growth rebinds the full range", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 10, 3);
		resetCCLDevMeasurements();

		applyRange(kernel, 10, 4);
		let mountedRowIndexes = getActiveRows(kernel)
			.map((row) => row.rowIndex)
			.sort((left, right) => left - right);
		expect(mountedRowIndexes).toEqual([10, 11, 12, 13]);
		let counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.reboundRowSlot"].count).toBe(1);
		expect(counters["twoHop.reboundCellSlot"].count).toBe(2);
		expect(counters["twoHop.physicalPool.resize"].count).toBe(0);

		resetCCLDevMeasurements();
		applyRange(kernel, 10, 7);

		mountedRowIndexes = getActiveRows(kernel)
			.map((row) => row.rowIndex)
			.sort((left, right) => left - right);
		expect(mountedRowIndexes).toEqual([10, 11, 12, 13, 14, 15, 16]);
		counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.reboundRowSlot"].count).toBe(7);
		expect(counters["twoHop.reboundCellSlot"].count).toBe(14);
		expect(counters["twoHop.physicalPool.resize"].count).toBe(1);
	});

	it("keeps physical row slots after sustained under-utilization", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0, 12);

		applyRange(kernel, 9, 3);
		applyRange(kernel, 9, 3);
		applyRange(kernel, 9, 3);

		expect(kernel.mountedRows).toHaveLength(17);
		expect(kernel.fixedRowSlotPool.controllers).toHaveLength(17);
		expect(
			getActiveRows(kernel)
				.map((row) => row.rowIndex)
				.sort((left, right) => left - right),
		).toEqual([9, 10, 11]);
	});
});
