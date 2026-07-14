import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
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

	it("retains an item body when a visible physical slot receives another logical item", async () => {
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
		resetCCLDevMeasurements();

		applyRange(kernel, 4);
		await tick();
		await tick();

		const reboundChild = container.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='0'] [data-testid='twohop-child-item-cell']",
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
		const controller = kernel.fixedRowSlotPool.controllers[0]?.cells[0];
		expect(controller).toBeDefined();
		if (!controller || !isItemCell(controller.mountedCell)) return;

		const { container } = render(TwoHopFixedRowSlotsSurfaceHarness, {
			props: { rowSlotControllers: kernel.fixedRowSlotPool.controllers },
		});
		await tick();
		const physicalCell = container.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='0']",
		);
		const initialBody = physicalCell?.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(initialBody).toBeTruthy();

		const previous = controller.mountedCell;
		controller.bindCell({
			...previous,
			key: `${String(previous.key)}:file` as typeof previous.key,
			logicalKey:
				`${String(previous.logicalKey)}:file` as typeof previous.logicalKey,
			cell: {
				...previous.cell,
				item: {
					kind: "primary-link",
					item: { type: "file", data: { basename: "file" } } as never,
					sourceSectionId: "backlinks",
					searchKey: "file-item",
					virtualKey: "file-item",
				} satisfies TwoHopVirtualListItem,
			},
		});
		await tick();
		await tick();

		const reboundPhysicalCell = container.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='0']",
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
		const controller = kernel.fixedRowSlotPool.controllers[0]?.cells[0];
		expect(controller).toBeDefined();
		if (!controller || !isItemCell(controller.mountedCell)) return;

		const { container } = render(TwoHopFixedRowSlotsSurfaceHarness, {
			props: { rowSlotControllers: kernel.fixedRowSlotPool.controllers },
		});
		await tick();

		const bindResolvedItem = (
			type: "branch" | "taggedNote" | "file" | "backlink",
			data: object,
			interactionId: string,
			itemSection: TwoHopVirtualListSection,
		): void => {
			const previous = controller.mountedCell;
			if (!isItemCell(previous)) return;
			controller.bindCell({
				...previous,
				key: `${String(previous.key)}:${type}` as typeof previous.key,
				logicalKey:
					`${String(previous.logicalKey)}:${type}` as typeof previous.logicalKey,
				section: itemSection,
				sectionId: itemSection.sectionId,
				cell: {
					...previous.cell,
					item: {
						kind: "primary-link",
						item: { type, data } as never,
						interactionId,
						sourceSectionId: "backlinks",
						searchKey: `${type}-item`,
						virtualKey: `${type}-item`,
					} satisfies TwoHopVirtualListItem,
				},
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
			"[data-ccl-cell-slot='0'] [data-testid='twohop-child-item-cell']",
		);
		expect(resolvedBody).toBeTruthy();
		expect(controller.binding?.reuseFamily).toBe("resolved-card");
		expect(controller.binding?.presentation).toMatchObject({
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
				"[data-ccl-cell-slot='0'] [data-testid='twohop-child-item-cell']",
			);
			expect(reboundBody).toBe(resolvedBody);
			expect(controller.binding?.reuseFamily).toBe("resolved-card");
			expect(controller.binding?.interactionId).toBe(item.interactionId);
			expect(controller.binding?.presentation).toMatchObject(
				item.expectedPresentation,
			);
		}

		kernel.dispose();
	});

	it("does not render a stale item while a standalone slot changes kind", async () => {
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
