import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import { compileTwoHopViewPlan, createTwoHopViewPlanRowModel } from "../twoHopViewPlan";
import { createTwoHopScalarScrollKernel } from "../twoHopScalarScrollKernel.svelte";
import {
	createTwoHopFixedRowSlotPool,
	type TwoHopFixedCellSlotController,
	type TwoHopFixedRowSlotController,
} from "../twoHopPhysicalSlotStore.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";
import type { TwoHopCellBinding } from "../twoHopCellBinding";
import { resolveTwoHopItemStaticState } from "../twoHopCellStaticState";
import TwoHopPooledGridRowsSurfaceHarness from "./TwoHopPooledGridRowsSurfaceHarness.svelte";
import TwoHopItemCellRenderHarness from "./TwoHopItemCellRenderHarness.svelte";

const items = Array.from({ length: 100 }, (_, index) => ({
	kind: "new-link" as const,
	item: {
		type: "newLink",
		data: {
			rawText: `new-link-${index}`,
			path: undefined,
			isUnresolved: true,
			sourceFile: { path: "notes/source.md" },
		},
	} as never,
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

function isItemCell(cell: TwoHopFixedCellSlotController): boolean {
	return cell.binding?.compiledCell.logicalCell.kind === "item";
}

function getMountedRow(
	kernel: ReturnType<typeof createTwoHopScalarScrollKernel>,
	rowIndex: number,
) {
	return kernel.mountedRows.find(
		(row) => row.rowIndex === rowIndex && row.cells.length > 0,
	);
}

function getFirstItemSlot(
	kernel: ReturnType<typeof createTwoHopScalarScrollKernel>,
):
	| {
			rowController: TwoHopFixedRowSlotController;
			controller: TwoHopFixedCellSlotController;
			binding: TwoHopCellBinding;
	  }
	| undefined {
	for (const rowController of kernel.fixedRowSlotPool.controllers) {
		for (const controller of rowController.cellControllers) {
			if (!isItemCell(controller) || !controller.binding) continue;
			return { rowController, controller, binding: controller.binding };
		}
	}
	return undefined;
}

function getPhysicalCellSelector(
	controller: TwoHopFixedCellSlotController,
): string {
	return `[data-ccl-cell-slot='${controller.cellSlotKey}']`;
}

function commitItemBinding(params: {
	pool: ReturnType<typeof createTwoHopFixedRowSlotPool>;
	rowController: TwoHopFixedRowSlotController;
	columnIndex: number;
	item: TwoHopVirtualListItem;
	section: TwoHopVirtualListSection;
}): void {
	const frame = params.rowController.frame;
	const previousBinding = frame?.cells[params.columnIndex];
	if (!frame || !previousBinding) return;
	const previousCompiledCell = previousBinding.compiledCell;
	if (previousCompiledCell.logicalCell.kind !== "item") return;
	const logicalKey = `${String(previousCompiledCell.logicalKey)}:${params.item.virtualKey}` as typeof previousCompiledCell.logicalKey;
	const compiledCell = {
		...previousCompiledCell,
		...resolveTwoHopItemStaticState(params.item, params.section),
		logicalKey,
		logicalCell: {
			...previousCompiledCell.logicalCell,
			kind: "item" as const,
			item: params.item,
		},
		renderBodyKey: logicalKey,
		renderBodySourceKey: params.item.virtualKey,
	};
	const cells = frame.cells.slice();
	cells[params.columnIndex] = {
		epoch: previousBinding.epoch + 1,
		logicalRowIndex: previousBinding.logicalRowIndex,
		columnIndex: params.columnIndex,
		compiledCell,
	};
	params.pool.commit({
		...frame,
		epoch: frame.epoch + 1,
		sectionPlan: {
			...frame.sectionPlan,
			descriptor: {
				...frame.sectionPlan.descriptor,
				section: params.section,
				sectionId: params.section.sectionId,
			},
		},
		cells,
	});
}

afterEach(() => cleanup());

describe("TwoHopItemCellRender", () => {
	it("shares compiled item state with each fresh binding snapshot", () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 1);
		const itemSlot = getFirstItemSlot(kernel);
		expect(itemSlot).toBeDefined();
		if (!itemSlot) return;
		const binding = itemSlot.controller.binding;
		const compiledCell = binding?.compiledCell;

		expect(compiledCell).toBeDefined();
		expect(binding?.compiledCell.presentation).toBe(compiledCell?.presentation);
		expect(binding?.compiledCell.reuseFamily).toBe("new-link");
		expect(binding?.compiledCell.interactionId).toBe(compiledCell?.interactionId);

		kernel.dispose();
	});

	it("renders a precreated empty slot when its row is recycled", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 0);
		const fullRow = getMountedRow(kernel, 0);
		const sourceFrame = fullRow?.frame;
		expect(fullRow?.cells).toHaveLength(2);
		expect(sourceFrame).toBeDefined();
		if (!sourceFrame) return;
		const standaloneFrame = {
			...sourceFrame,
			slotIndex: 0,
		};

		const pool = createTwoHopFixedRowSlotPool();
		pool.setCapacity(1, 2);
		pool.commit({ ...standaloneFrame, cells: sourceFrame.cells.slice(0, 1) });
		const { container } = render(TwoHopPooledGridRowsSurfaceHarness, {
			props: { rowSlotControllers: pool.controllers },
		});
		await tick();
		expect(container.querySelector("[data-ccl-cell-slot='1']")).toBeNull();

		pool.commit(standaloneFrame);
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
			.flatMap((row) => row.cellControllers)
			.find((cell) => cell.binding?.compiledCell.logicalCell.kind === "item");
		expect(controller).toBeDefined();
		if (!controller || controller.binding?.compiledCell.logicalCell.kind !== "item") return;

		const getItemActivationCandidateId = vi.fn(
			(cell: TwoHopFixedCellSlotController) =>
				`candidate:${cell.binding?.compiledCell.logicalCell.kind === "item" ? cell.binding.compiledCell.logicalCell.item.virtualKey : "empty"}`,
		);
		const { container } = render(TwoHopItemCellRenderHarness, {
			props: {
				cellController: controller,
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
		expect(getItemActivationCandidateId).toHaveBeenCalledTimes(1);

		applyRange(kernel, 7);
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
		expect(getItemActivationCandidateId).toHaveBeenCalledTimes(2);
		expect(
			container.querySelector<HTMLElement>("[data-activation-candidate-id]")
				?.dataset.activationCandidateId,
		).toBe(`candidate:${reboundChild?.dataset.index}`);

		kernel.dispose();
	});

	it("retains an item body when a visible physical slot receives another logical item", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 1);
		const itemSlot = getFirstItemSlot(kernel);
		expect(itemSlot).toBeDefined();
		if (!itemSlot) return;
		const physicalCellSelector = getPhysicalCellSelector(itemSlot.controller);
		const { container } = render(TwoHopPooledGridRowsSurfaceHarness, {
			props: {
				rowSlotControllers: kernel.fixedRowSlotPool.controllers,
			},
		});
		await tick();

		const initialChild = container.querySelector<HTMLElement>(
			`${physicalCellSelector} [data-testid='twohop-child-item-cell']`,
		);
		const initialIndex = initialChild?.dataset.index;
		const initialInstanceId = initialChild?.dataset.instanceId;
		expect(initialChild).toBeTruthy();
		resetCCLDevMeasurements();

		applyRange(kernel, 7);
		await tick();
		await tick();

		const reboundChild = container.querySelector<HTMLElement>(
			`${physicalCellSelector} [data-testid='twohop-child-item-cell']`,
		);
		expect(reboundChild).toBeTruthy();
		expect(reboundChild).toBe(initialChild);
		expect(reboundChild?.dataset.instanceId).toBe(initialInstanceId);
		expect(reboundChild?.dataset.index).not.toBe(initialIndex);
		expect(
			getCCLDevMeasurementSnapshot().counters["twoHop.itemBody.mount"].count,
		).toBe(0);

		kernel.dispose();
	});

	it("remounts only the item body when a physical slot crosses a reuse-family boundary", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 1);
		const itemSlot = getFirstItemSlot(kernel);
		expect(itemSlot).toBeDefined();
		if (!itemSlot) return;
		const { controller, rowController } = itemSlot;
		const physicalCellSelector = getPhysicalCellSelector(controller);

		const { container } = render(TwoHopPooledGridRowsSurfaceHarness, {
			props: { rowSlotControllers: kernel.fixedRowSlotPool.controllers },
		});
		await tick();
		const physicalCell = container.querySelector<HTMLElement>(
			physicalCellSelector,
		);
		const initialBody = physicalCell?.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(initialBody).toBeTruthy();

		commitItemBinding({
			pool: kernel.fixedRowSlotPool,
			rowController,
			columnIndex: controller.columnIndex,
			section,
			item: {
				kind: "primary-link",
				item: { type: "file", data: { basename: "file" } } as never,
				sourceSectionId: "backlinks",
				searchKey: "file-item",
				virtualKey: "file-item",
			} satisfies TwoHopVirtualListItem,
		});
		await tick();
		await tick();

		const reboundPhysicalCell = container.querySelector<HTMLElement>(
			physicalCellSelector,
		);
		const reboundBody = reboundPhysicalCell?.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(reboundPhysicalCell).toBe(physicalCell);
		expect(reboundBody).toBeTruthy();
		expect(reboundBody).not.toBe(initialBody);

		kernel.dispose();
	});

	it("retains one item body across resolved view-item types", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		applyRange(kernel, 1);
		const itemSlot = getFirstItemSlot(kernel);
		expect(itemSlot).toBeDefined();
		if (!itemSlot) return;
		const { controller, rowController } = itemSlot;
		const physicalCellSelector = getPhysicalCellSelector(controller);

		const { container } = render(TwoHopPooledGridRowsSurfaceHarness, {
			props: { rowSlotControllers: kernel.fixedRowSlotPool.controllers },
		});
		await tick();

		const bindResolvedItem = (
			type: "branch" | "taggedNote" | "file" | "backlink",
			data: object,
			interactionId: string,
			itemSection: TwoHopVirtualListSection,
		): void => {
			commitItemBinding({
				pool: kernel.fixedRowSlotPool,
				rowController,
				columnIndex: controller.columnIndex,
				section: itemSection,
				item: {
					kind: "primary-link",
					item: { type, data } as never,
					interactionId,
					sourceSectionId: "backlinks",
					searchKey: `${type}-item`,
					virtualKey: `${type}-item`,
				} satisfies TwoHopVirtualListItem,
			});
		};

		bindResolvedItem(
			"branch",
			{ hop1: { isUnresolved: false, path: "notes/branch.md" }, hop2: [] },
			"item:branch:notes/branch.md",
			{
				...section,
				kind: "primary-section",
				rawSectionId: "outgoing",
				sectionId: "outgoing",
				source: {} as never,
			},
		);
		await tick();
		await tick();

		const resolvedBody = container.querySelector<HTMLElement>(
			`${physicalCellSelector} [data-testid='twohop-child-item-cell']`,
		);
		expect(resolvedBody).toBeTruthy();
		expect(controller.binding?.compiledCell.reuseFamily).toBe("resolved-card");
		expect(controller.binding?.compiledCell.presentation).toMatchObject({
			sectionVariant: "outgoing",
			resolution: "resolved",
			extension: null,
		});

		const resolvedItems = [
			{
				type: "taggedNote" as const,
				data: {
					file: { extension: "md" },
					path: "notes/tagged.md",
					commonTags: ["tag"],
				},
				interactionId: "item:taggedNote:notes/tagged.md",
				section: {
					...section,
					kind: "tag-section" as const,
					sectionId: "tagged",
					tag: "#tag",
					headerProps: {} as never,
				},
				expectedPresentation: {
					sectionVariant: "tag",
					extension: null,
					attachment: false,
				},
			},
			{
				type: "file" as const,
				data: { extension: "pdf", path: "files/document.pdf" },
				interactionId: "item:file:files/document.pdf",
				section: {
					...section,
					kind: "primary-section" as const,
					rawSectionId: "merged",
					sectionId: "merged",
					source: {} as never,
				},
				expectedPresentation: {
					sectionVariant: "merged",
					extension: "pdf",
					attachment: true,
				},
			},
			{
				type: "backlink" as const,
				data: {
					sourceFile: { extension: "md", path: "notes/backlink.md" },
				},
				interactionId: "item:backlink:notes/backlink.md",
				section: {
					...section,
					kind: "primary-section" as const,
					rawSectionId: "backlinks",
					sectionId: "backlinks",
					source: {} as never,
				},
				expectedPresentation: {
					sectionVariant: "backlinks",
					extension: null,
					attachment: false,
				},
			},
		];

		for (const item of resolvedItems) {
			bindResolvedItem(item.type, item.data, item.interactionId, item.section);
			await tick();
			await tick();

			const reboundBody = container.querySelector<HTMLElement>(
				`${physicalCellSelector} [data-testid='twohop-child-item-cell']`,
			);
			expect(reboundBody).toBe(resolvedBody);
			expect(controller.binding?.compiledCell.reuseFamily).toBe("resolved-card");
			expect(controller.binding?.compiledCell.interactionId).toBe(item.interactionId);
			expect(controller.binding?.compiledCell.presentation).toMatchObject(
				item.expectedPresentation,
			);
		}

		kernel.dispose();
	});

	it("does not render a stale item after a standalone slot leaves the range", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModelWithLoadMore,
			onStableVisibleRange() {},
		});
		applySingleRowRange(kernel, 1);
		const itemSlot = getFirstItemSlot(kernel);
		expect(itemSlot).toBeDefined();
		if (!itemSlot) return;
		const { controller } = itemSlot;

		const getItemActivationCandidateId = vi.fn(
			(cell: TwoHopFixedCellSlotController) =>
				`candidate:${cell.cellSlotKey}`,
		);
		const { container } = render(TwoHopItemCellRenderHarness, {
			props: {
				cellController: controller,
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

		expect(controller.renderBodyKind).not.toBe("item");
		const staleChild = container.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(staleChild).toBeNull();
		expect(initialChild?.dataset.index).toBe(initialIndex);

		kernel.dispose();
	});

	it("remounts the body when a recycled physical slot changes cell kind", async () => {
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModelWithLoadMore,
			onStableVisibleRange() {},
		});
		applySingleRowRange(kernel, 1);
		const { container } = render(TwoHopPooledGridRowsSurfaceHarness, {
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
