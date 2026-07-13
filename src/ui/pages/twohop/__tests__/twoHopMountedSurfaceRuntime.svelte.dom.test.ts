import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import Harness from "./TwoHopMountedSurfaceRuntimeHarness.svelte";
import type { TwoHopMountedSurfaceRuntime } from "../twoHopMountedSurfaceRuntime.svelte";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	type TwoHopViewPlanRowModel,
} from "../twoHopViewPlan";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";

const items = Array.from(
	{ length: 12 },
	(_, index): TwoHopVirtualListItem => ({
		kind: "new-link",
		item: { type: "link" } as unknown as TwoHopVirtualListItem["item"],
		searchKey: `item-${index}`,
		virtualKey: `item-${index}`,
	}),
);
const section: TwoHopVirtualListSection = {
	kind: "new-links-section",
	rawSectionId: "new-links",
	sectionId: "new-links",
	sectionKey: "new-links",
	title: "New links",
	getKey: () => "",
};
const descriptor: SectionRenderDescriptor<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
> = {
	section,
	sectionKey: section.sectionKey,
	sectionId: section.sectionId,
	title: section.title,
	totalCount: items.length,
	loadedCount: items.length,
	getItems: () => items,
	headerProps: {},
};

function createRowModel(visibleCount: number, columns = 2): TwoHopViewPlanRowModel {
	return createTwoHopViewPlanRowModel(
		compileTwoHopViewPlan({
			sections: [descriptor],
			sectionVisibleCounts: { "new-links": visibleCount },
			layout: {
				containerWidth: columns * 110,
				columns,
				cellWidth: 100,
				rowHeight: 100,
				gap: 10,
				sectionMarginBottom: 20,
			},
			resolveInitialSectionVisibleCount: () => visibleCount,
			clampVisibleCount: (_current, count) => count,
		}),
	);
}

function applyInitialMeasurement(
	runtime: TwoHopMountedSurfaceRuntime,
	rowModel: TwoHopViewPlanRowModel,
): void {
	runtime.virtualList.applyMeasurement({
		rowModel,
		scrollTop: 0,
		viewportHeight: 300,
		sectionTop: 0,
		isStableMeasurement: true,
		isScrollActive: false,
		hasStableVisibleRange: true,
		precomputedRanges: {
			mounted: { start: 0, end: 3 },
			previewVisible: { start: 0, end: 3 },
		},
		visibilityPolicy: {
			bootstrapRows: 3,
			mountedOverscanPx: 0,
		},
	});
}

describe("TwoHop mounted surface runtime", () => {
	afterEach(cleanup);

	it("rebinds the current physical slots when the input row model changes", async () => {
		const initialRowModel = createRowModel(4);
		const updatedRowModel = createRowModel(8);
		let runtime: TwoHopMountedSurfaceRuntime | undefined;
		const rendered = render(Harness, {
			props: {
				rowModel: initialRowModel,
				onRuntime(nextRuntime: TwoHopMountedSurfaceRuntime) {
					runtime = nextRuntime;
				},
			},
		});
		expect(runtime).toBeDefined();
		if (!runtime) return;
		applyInitialMeasurement(runtime, initialRowModel);
		expect(runtime.fixedRowSlotControllers[2]?.cells[1]?.renderBodyKind).toBe(
			"load-more",
		);

		await rendered.rerender({
			rowModel: updatedRowModel,
			onRuntime(nextRuntime: TwoHopMountedSurfaceRuntime) {
				runtime = nextRuntime;
			},
		});
		await tick();

		expect(runtime.fixedRowSlotControllers[2]?.cells[1]?.renderBodyKind).toBe(
			"item",
		);
		expect(String(runtime.fixedRowSlotControllers[2]?.cells[1]?.logicalKey)).toBe(
			"new-links::item:4",
		);
	});

	it("rebuilds the physical pool when the row model column count changes", async () => {
		const initialRowModel = createRowModel(8, 3);
		const updatedRowModel = createRowModel(8, 2);
		let runtime: TwoHopMountedSurfaceRuntime | undefined;
		const rendered = render(Harness, {
			props: {
				rowModel: initialRowModel,
				onRuntime(nextRuntime: TwoHopMountedSurfaceRuntime) {
					runtime = nextRuntime;
				},
			},
		});
		expect(runtime).toBeDefined();
		if (!runtime) return;
		applyInitialMeasurement(runtime, initialRowModel);
		expect(
			runtime.fixedRowSlotControllers[0]?.cells.filter((cell) => cell.active),
		).toHaveLength(3);

		await rendered.rerender({
			rowModel: updatedRowModel,
			onRuntime(nextRuntime: TwoHopMountedSurfaceRuntime) {
				runtime = nextRuntime;
			},
		});
		await tick();

		expect(
			runtime.fixedRowSlotControllers[0]?.cells.filter((cell) => cell.active),
		).toHaveLength(2);
		expect(String(runtime.fixedRowSlotControllers[1]?.cells[0]?.logicalKey)).toBe(
			"new-links::item:1",
		);
		expect(runtime.contentHeight).toBe(updatedRowModel.totalHeight);
	});
});
