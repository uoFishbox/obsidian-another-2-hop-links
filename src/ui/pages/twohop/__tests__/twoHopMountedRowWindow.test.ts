import { describe, expect, it } from "vitest";
import type { TwoHopVirtualSectionDescriptor } from "../twoHopVirtualListModel";
import { compileTwoHopViewPlan, createTwoHopViewPlanRowModel } from "../twoHopViewPlan";
import { createTwoHopMountedRowWindow } from "../twoHopMountedRowWindow";

const items = ["a", "b", "c", "d"].map((key) => ({
	kind: "new-link" as const,
	item: { type: "link" } as never,
	searchKey: key,
	virtualKey: key,
}));

const descriptor: TwoHopVirtualSectionDescriptor = {
	section: {
		kind: "new-links-section",
		rawSectionId: "new-links",
		sectionId: "new-links",
		sectionKey: "new-links",
		title: "New links",
		getKey: () => "",
	},
	sectionKey: "new-links",
	title: "New links",
	sectionId: "new-links",
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
			containerWidth: 100,
			columns: 1,
			cellWidth: 100,
			rowHeight: 100,
			gap: 0,
			sectionMarginBottom: 0,
		},
		materialization: { kind: "eager" },
		resolveInitialSectionVisibleCount: (section) => section.loadedCount,
		clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
	}),
);

const ranges = {
	mounted: { start: 0, end: 2 },
	previewVisible: { start: 0, end: 2 },
};

function createBatchedRowModel() {
	return createTwoHopViewPlanRowModel(
		compileTwoHopViewPlan({
			sections: [descriptor],
			sectionVisibleCounts: { "new-links": items.length },
			layout: {
				containerWidth: 100,
				columns: 1,
				cellWidth: 100,
				rowHeight: 100,
				gap: 0,
				sectionMarginBottom: 0,
			},
			materialization: {
				kind: "batched",
				initial: {
					maxSectionCount: 0,
					maxCellCount: 0,
				},
				background: {
					maxCellCountPerSlice: 128,
				},
			},
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		}),
	);
}

describe("createTwoHopMountedRowWindow", () => {
	it("returns changed on first apply", () => {
		const window = createTwoHopMountedRowWindow();
		const result = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		expect(window.lastApplyChanged).toBe(true);
		expect(result).toBeDefined();
		expect(result.rowSlices.length).toBeGreaterThan(0);
	});

	it("returns unchanged when plan, range, and cellStore.revision are identical", () => {
		const window = createTwoHopMountedRowWindow();

		const first = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});
		expect(window.lastApplyChanged).toBe(true);

		const second = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});
		expect(window.lastApplyChanged).toBe(false);
		expect(second).toBe(first);
	});

	it("returns unchanged after build materializes the same batched range", () => {
		const batchedRowModel = createBatchedRowModel();
		const window = createTwoHopMountedRowWindow();
		const revisionBeforeApply = batchedRowModel.plan.cellStore.revision;

		const first = window.apply({
			rowModel: batchedRowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		expect(window.lastApplyChanged).toBe(true);
		expect(batchedRowModel.plan.cellStore.revision).toBeGreaterThan(
			revisionBeforeApply,
		);

		const second = window.apply({
			rowModel: batchedRowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		expect(window.lastApplyChanged).toBe(false);
		expect(second).toBe(first);
	});

	it("returns unchanged with same build object identity", () => {
		const window = createTwoHopMountedRowWindow();

		const first = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});
		const second = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		// Same object reference — no allocation.
		expect(second).toBe(first);
	});

	it("returns changed when range changes", () => {
		const window = createTwoHopMountedRowWindow();

		window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		const result = window.apply({
			rowModel,
			rowRange: { start: 1, end: 3 },
			ranges,
		});

		expect(result).toBe(window.build);
		expect(window.lastApplyChanged).toBe(true);
	});

	it("returns unchanged when only the global cellStore.revision changes with same range", () => {
		const window = createTwoHopMountedRowWindow();

		const first = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});
		expect(window.lastApplyChanged).toBe(true);

		// Bump cellStore.revision (simulating background materialization).
		rowModel.plan.cellStore.revision += 1;

		const second = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		expect(second).toBe(first);
		expect(window.lastApplyChanged).toBe(false);
	});

	it("returns changed rows when a mounted row materialization revision changes", () => {
		const window = createTwoHopMountedRowWindow();

		const first = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});
		expect(window.lastApplyChanged).toBe(true);

		rowModel.plan.cellStore.revision += 1;
		rowModel.plan.cellStore.rowRevisionByRowIndex[0] += 1;

		const second = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		expect(second).not.toBe(first);
		expect(second.rowSlices[0]).not.toBe(first.rowSlices[0]);
		expect(second.rowSlices[1]).toBe(first.rowSlices[1]);
		expect(window.lastApplyChanged).toBe(true);
	});

	it("returns changed when plan changes", () => {
		const window = createTwoHopMountedRowWindow();

		window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		// Create a new plan (simulating data change).
		const newItems = ["x", "y"].map((key) => ({
			kind: "new-link" as const,
			item: { type: "link" } as never,
			searchKey: key,
			virtualKey: key,
		}));
		const newDescriptor: TwoHopVirtualSectionDescriptor = {
			...descriptor,
			totalCount: newItems.length,
			loadedCount: newItems.length,
			getItems: () => newItems,
		};
		const newRowModel = createTwoHopViewPlanRowModel(
			compileTwoHopViewPlan({
				sections: [newDescriptor],
				sectionVisibleCounts: { "new-links": newItems.length },
				layout: {
					containerWidth: 100,
					columns: 1,
					cellWidth: 100,
					rowHeight: 100,
					gap: 0,
					sectionMarginBottom: 0,
				},
				materialization: { kind: "eager" },
				resolveInitialSectionVisibleCount: (section) => section.loadedCount,
				clampVisibleCount: (section, count) =>
					Math.min(section.loadedCount, count),
			}),
		);

		const result = window.apply({
			rowModel: newRowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		expect(result).toBe(window.build);
		expect(window.lastApplyChanged).toBe(true);
	});

	it("reset clears state so next apply returns changed", () => {
		const window = createTwoHopMountedRowWindow();

		window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		window.reset();

		const result = window.apply({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		expect(result).toBe(window.build);
		expect(window.lastApplyChanged).toBe(true);
	});
});
