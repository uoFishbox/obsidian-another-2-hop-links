import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
import { compileTwoHopViewPlan, createTwoHopViewPlanRowModel } from "../twoHopViewPlan";
import { createTwoHopScalarScrollKernel } from "../twoHopScalarScrollKernel.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";
import type { TwoHopMountedCell } from "../twoHopMountedTypes";
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

function isItemCell(
	cell: TwoHopMountedCell,
): cell is Extract<TwoHopMountedCell, { cell: { kind: "item" } }> {
	return cell.cell.kind === "item";
}

afterEach(() => cleanup());

describe("TwoHopItemCellRender", () => {
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
});
