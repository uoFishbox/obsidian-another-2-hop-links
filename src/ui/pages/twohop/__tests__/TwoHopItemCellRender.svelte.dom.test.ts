import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
import { compileTwoHopViewPlan, createTwoHopViewPlanRowModel } from "../twoHopViewPlan";
import { createTwoHopScalarScrollKernel } from "../twoHopScalarScrollKernel.svelte";
import { createTwoHopFixedRowSlotPool } from "../twoHopFixedRowSlotPool.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";
import type { TwoHopMountedCell } from "../twoHopMountedTypes";
import TwoHopFixedRowSlotsSurfaceHarness from "./TwoHopFixedRowSlotsSurfaceHarness.svelte";
import TwoHopItemCellRenderHarness from "./TwoHopItemCellRenderHarness.svelte";

const items = Array.from({ length: 100 }, (_, index) => ({
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

const rowModelWithLoadMore = createTwoHopViewPlanRowModel(
	compileTwoHopViewPlan({
		sections: [descriptor],
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

function applySingleRowRange(
	kernel: ReturnType<typeof createTwoHopScalarScrollKernel>,
	start: number,
): void {
	kernel.applyMeasurement({
		rowModel: rowModelWithLoadMore,
		scrollTop: 0,
		viewportHeight: 100,
		sectionTop: 0,
		isStableMeasurement: true,
		isScrollActive: true,
		hasStableVisibleRange: true,
		precomputedRanges: {
			mounted: { start, end: start + 1 },
			previewVisible: { start, end: start + 1 },
		},
		visibilityPolicy: {
			bootstrapRows: 1,
			mountedOverscanPx: 0,
		},
	});
}

function isItemCell(
	cell: TwoHopMountedCell | undefined,
): cell is Extract<TwoHopMountedCell, { cell: { kind: "item" } }> {
	return cell?.cell.kind === "item";
}

afterEach(() => cleanup());

describe("TwoHopItemCellRender", () => {
	it("renders a precreated empty slot when its row is recycled", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 1);
		const fullRow = kernel.mountedRows[0];
		const firstCell = fullRow?.cells[0];
		expect(fullRow?.cells).toHaveLength(2);
		expect(firstCell).toBeDefined();
		if (!fullRow || !firstCell) return;

		const pool = createTwoHopFixedRowSlotPool();
		pool.setCapacity(1, 2);
		pool.bindRow({ ...fullRow, cells: [firstCell] });
		const { container } = render(TwoHopFixedRowSlotsSurfaceHarness, {
			props: { rowSlotControllers: pool.controllers },
		});
		await tick();
		expect(container.querySelector("[data-ccl-cell-slot='1']")).toBeNull();

		pool.bindRow(fullRow);
		await tick();
		await tick();

		expect(container.querySelector("[data-ccl-cell-slot='1']")).toBeTruthy();
		kernel.dispose();
	});

	it("resolves one snapshot per slot reassignment and updates a retained child", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 1);
		const controller = kernel.fixedRowSlotPool.controllers
			.flatMap((row) => row.cells)
			.find((cell) => isItemCell(cell.mountedCell));
		expect(controller).toBeDefined();
		if (!controller || !isItemCell(controller.mountedCell)) return;

		const visibilityState = {
			visibility: "mounted",
		} as VirtualizedItemVisibilityState;
		const getItemVisibilityState = vi.fn(() => visibilityState);
		const getItemActivationCandidateId = vi.fn(
			(cell: Extract<TwoHopMountedCell, { cell: { kind: "item" } }>) =>
				`candidate:${cell.cell.item.virtualKey}`,
		);
		const { container } = render(TwoHopItemCellRenderHarness, {
			props: {
				cellController: controller,
				initialCell: controller.mountedCell,
				getItemVisibilityState,
				getItemActivationCandidateId,
			},
		});
		await tick();

		const initialChild = container.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		const initialIndex = initialChild?.dataset.index;
		const initialInstanceId = initialChild?.dataset.instanceId;
		expect(initialChild).toBeTruthy();
		expect(getItemVisibilityState).toHaveBeenCalledTimes(1);
		expect(getItemActivationCandidateId).toHaveBeenCalledTimes(1);

		applyRange(kernel, 4);
		await tick();
		await tick();

		const reboundChild = container.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(reboundChild).toBe(initialChild);
		expect(reboundChild?.dataset.instanceId).toBe(initialInstanceId);
		expect(reboundChild?.dataset.index).not.toBe(initialIndex);
		expect(reboundChild?.dataset.renderedKey).toBe(
			`${reboundChild?.dataset.index}:${reboundChild?.dataset.rowIndex}`,
		);
		expect(getItemVisibilityState).toHaveBeenCalledTimes(2);
		expect(getItemActivationCandidateId).toHaveBeenCalledTimes(2);
		expect(
			container.querySelector<HTMLElement>("[data-activation-candidate-id]")
				?.dataset.activationCandidateId,
		).toBe(`candidate:${reboundChild?.dataset.index}`);

		kernel.dispose();
	});

	it("remounts an item body when a visible physical slot receives another logical item", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 1);
		const { container } = render(TwoHopFixedRowSlotsSurfaceHarness, {
			props: {
				rowSlotControllers: kernel.fixedRowSlotPool.controllers,
			},
		});
		await tick();

		const initialChild = container.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='0'] [data-testid='twohop-child-item-cell']",
		);
		const initialIndex = initialChild?.dataset.index;
		const initialInstanceId = initialChild?.dataset.instanceId;
		expect(initialChild).toBeTruthy();

		applyRange(kernel, 4);
		await tick();
		await tick();

		const reboundChild = container.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='0'] [data-testid='twohop-child-item-cell']",
		);
		expect(reboundChild).toBeTruthy();
		expect(reboundChild).not.toBe(initialChild);
		expect(reboundChild?.dataset.instanceId).not.toBe(initialInstanceId);
		expect(reboundChild?.dataset.index).not.toBe(initialIndex);

		kernel.dispose();
	});

	it("keeps an item snapshot valid while its physical slot changes kind", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModelWithLoadMore,
			onStableVisibleRange() {},
		});
		applySingleRowRange(kernel, 1);
		const controller = kernel.fixedRowSlotPool.controllers[0]?.cells[0];
		expect(controller).toBeDefined();
		if (!controller || !isItemCell(controller.mountedCell)) return;

		const getItemVisibilityState = vi.fn(() => ({
			visibility: "mounted" as const,
		}));
		const getItemActivationCandidateId = vi.fn(
			(cell: Extract<TwoHopMountedCell, { cell: { kind: "item" } }>) =>
				`candidate:${cell.cell.item.virtualKey}`,
		);
		const { container } = render(TwoHopItemCellRenderHarness, {
			props: {
				cellController: controller,
				initialCell: controller.mountedCell,
				getItemVisibilityState,
				getItemActivationCandidateId,
			},
		});
		await tick();

		const initialChild = container.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		const initialIndex = initialChild?.dataset.index;
		expect(initialChild).toBeTruthy();

		applySingleRowRange(kernel, 2);
		await tick();
		await tick();

		expect(controller.renderBodyKind).toBe("load-more");
		const retainedChild = container.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(retainedChild).toBe(initialChild);
		expect(retainedChild?.dataset.index).toBe(initialIndex);

		kernel.dispose();
	});

	it("remounts the body when a recycled physical slot changes cell kind", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModelWithLoadMore,
			onStableVisibleRange() {},
		});
		applySingleRowRange(kernel, 1);
		const { container } = render(TwoHopFixedRowSlotsSurfaceHarness, {
			props: {
				rowSlotControllers: kernel.fixedRowSlotPool.controllers,
			},
		});
		await tick();

		const initialItem = container.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(initialItem).toBeTruthy();
		expect(
			container.querySelector("[data-testid='twohop-load-more-cell']"),
		).toBeNull();

		applySingleRowRange(kernel, 2);
		await tick();
		await tick();

		expect(
			container.querySelector("[data-testid='twohop-child-item-cell']"),
		).toBeNull();
		expect(
			container.querySelector("[data-testid='twohop-load-more-cell']"),
		).toBeTruthy();

		applySingleRowRange(kernel, 1);
		await tick();
		await tick();

		const remountedItem = container.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(remountedItem).toBeTruthy();
		expect(remountedItem).not.toBe(initialItem);

		kernel.dispose();
	});
});
