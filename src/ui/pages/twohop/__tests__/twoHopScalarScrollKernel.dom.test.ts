import { describe, expect, it } from "vitest";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
} from "../twoHopViewPlan";
import { createTwoHopScalarScrollKernel } from "../twoHopScalarScrollKernel.svelte";
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

function applyRange(
	kernel: ReturnType<typeof createTwoHopScalarScrollKernel>,
	start: number,
): void {
	kernel.applyMeasurement({
		rowModel,
		scrollTop: 0,
		viewportHeight: 100,
		sectionTop: 0,
		isStableMeasurement: true,
		isScrollActive: true,
		hasStableVisibleRange: true,
		precomputedRanges: {
			mounted: { start, end: start + 3 },
			previewVisible: { start: start + 1, end: start + 2 },
		},
		visibilityPolicy: {
			bootstrapRows: 1,
			mountedOverscanPx: 0,
		},
	});
}

describe("TwoHop scalar scroll kernel", () => {
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

		resetCCLDevMeasurements();
		applyRange(kernel, 1);

		expect(kernel.mountedRows).toBe(mountedRows);
		expect(kernel.fixedRowSlotPool.controllers).toBe(controllers);
		expect(mountedRows[0]).toBe(recycledRowShell);
		expect(mountedRows[0]?.rowIndex).toBe(3);
		expect(mountedRows[0]?.cells[0]).toBe(recycledCellShells[0]);
		expect(mountedRows[0]?.cells[1]).toBe(recycledCellShells[1]);

		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.scalarKernel.rowShellCreated"].count).toBe(0);
		expect(counters["twoHop.scalarKernel.cellShellCreated"].count).toBe(0);
		expect(counters["twoHop.reboundRowSlot"].count).toBe(1);
		expect(counters["twoHop.reboundCellSlot"].count).toBe(2);
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
});
