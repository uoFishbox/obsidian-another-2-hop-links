import { describe, expect, it } from "vitest";
import type { TwoHopVirtualSectionDescriptor } from "../twoHopVirtualListModel";
import { compileTwoHopViewPlan, createTwoHopViewPlanRowModel } from "../twoHopViewPlan";
import { createTwoHopMountRuntime } from "../twoHopMountRuntime.svelte";

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

describe("createTwoHopMountRuntime", () => {
	it("owns mounted row reuse and preview visibility history", () => {
		const runtime = createTwoHopMountRuntime();
		const mounted = runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 0, end: 3 },
			ranges: {
				mounted: { start: 0, end: 3 },
				previewVisible: { start: 1, end: 2 },
			},
		});
		const firstItem = mounted.rowSlices[1]?.cells[0];
		if (!firstItem) throw new Error("Expected first mounted item.");

		runtime.syncSnapshot(mounted, { start: 1, end: 2 });
		const firstState = runtime.getOrCreateVisibilityState(firstItem, "visible");
		runtime.syncSnapshot(mounted, { start: 2, end: 3 });
		expect(firstState.visibility).toBe("mounted");

		const scrolled = runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 2, end: 3 },
			ranges: {
				mounted: { start: 2, end: 3 },
				previewVisible: { start: 2, end: 3 },
			},
			previousBuild: mounted,
		});
		runtime.syncSnapshot(scrolled, { start: 2, end: 3 });

		expect(scrolled.rowSlices[0]?.slotKey).toBe(mounted.rowSlices[2]?.slotKey);
		expect(runtime.getOrCreateVisibilityState(firstItem, "visible")).not.toBe(
			firstState,
		);
	});

	it("supports preview range objects that are reused by the caller", () => {
		const runtime = createTwoHopMountRuntime();
		const mounted = runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 0, end: 3 },
			ranges: {
				mounted: { start: 0, end: 3 },
				previewVisible: { start: 1, end: 2 },
			},
		});
		const firstItem = mounted.rowSlices[1]?.cells[0];
		const secondItem = mounted.rowSlices[2]?.cells[0];
		if (!firstItem || !secondItem) {
			throw new Error("Expected mounted items.");
		}

		const reusedRange = { start: 1, end: 2 };
		runtime.syncSnapshot(mounted, reusedRange);
		const firstState = runtime.getOrCreateVisibilityState(firstItem, "visible");
		const secondState = runtime.getOrCreateVisibilityState(secondItem, "mounted");

		reusedRange.start = 2;
		reusedRange.end = 3;
		runtime.syncSnapshot(mounted, reusedRange);

		expect(firstState.visibility).toBe("mounted");
		expect(secondState.visibility).toBe("visible");
	});

	it("keeps visibility state on the reused render slot when the logical item changes", () => {
		const runtime = createTwoHopMountRuntime();
		const mounted = runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 1, end: 4 },
			ranges: {
				mounted: { start: 1, end: 4 },
				previewVisible: { start: 1, end: 2 },
			},
		});
		const removedItem = mounted.rowSlices[0]?.cells[0];
		if (!removedItem) {
			throw new Error("Expected removed mounted item.");
		}

		runtime.syncSnapshot(mounted, { start: 1, end: 2 });
		const state = runtime.getOrCreateVisibilityState(removedItem, "visible");

		const scrolled = runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 2, end: 5 },
			ranges: {
				mounted: { start: 2, end: 5 },
				previewVisible: { start: 4, end: 5 },
			},
			previousBuild: mounted,
		});
		runtime.syncSnapshot(scrolled, { start: 4, end: 5 });

		const addedItem = scrolled.rowSlices.find((row) => row.rowIndex === 4)
			?.cells[0];
		if (!addedItem) {
			throw new Error("Expected added mounted item.");
		}

		expect(addedItem.cellSlotKey).toBe(removedItem.cellSlotKey);
		expect(runtime.getOrCreateVisibilityState(addedItem, "mounted")).toBe(state);
		expect(state.visibility).toBe("visible");
	});

	it("returns the previous build by identity on same-plan, same-range recompute", () => {
		const runtime = createTwoHopMountRuntime();
		const range = { start: 0, end: 2 };
		const ranges = {
			mounted: range,
			previewVisible: range,
		};
		const mounted = runtime.buildMountedRows({
			rowModel,
			rowRange: range,
			ranges,
		});

		const recomputed = runtime.buildMountedRows({
			rowModel,
			rowRange: range,
			ranges,
			previousBuild: mounted,
		});

		// Same plan object + same clamped mounted range must short-circuit to
		// the previous build reference, preserving rowSlices array identity.
		expect(recomputed).toBe(mounted);
		expect(recomputed.rowSlices).toBe(mounted.rowSlices);
		expect(recomputed.cells).toBe(mounted.cells);
		expect(recomputed.reusableCellsByKey).toBe(mounted.reusableCellsByKey);
		expect(recomputed.mountedCellCount).toBe(mounted.mountedCellCount);
		expect(recomputed.nextRenderSlotIndex).toBe(mounted.nextRenderSlotIndex);
	});

	it("does not reuse the previous build when the clamped range differs", () => {
		const runtime = createTwoHopMountRuntime();
		const ranges = {
			mounted: { start: 0, end: 2 },
			previewVisible: { start: 0, end: 2 },
		};
		const mounted = runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges,
		});

		const scrolled = runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 1, end: 2 },
			ranges: {
				mounted: { start: 1, end: 2 },
				previewVisible: { start: 1, end: 2 },
			},
			previousBuild: mounted,
		});

		expect(scrolled).not.toBe(mounted);
		expect(scrolled.rowSlices).not.toBe(mounted.rowSlices);
		// The surviving row slice is still reused by reference.
		expect(scrolled.rowSlices[0]).toBe(mounted.rowSlices[1]);
	});

	it("syncs mounted range changes without scanning kept rows", () => {
		const runtime = createTwoHopMountRuntime();
		const mounted = runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 0, end: 3 },
			ranges: {
				mounted: { start: 0, end: 3 },
				previewVisible: { start: 1, end: 3 },
			},
		});
		runtime.syncSnapshot(mounted, { start: 1, end: 3 });

		const scrolled = runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 1, end: 4 },
			ranges: {
				mounted: { start: 1, end: 4 },
				previewVisible: { start: 1, end: 3 },
			},
			previousBuild: mounted,
		});
		const keptRows = scrolled.rowSlices.filter(
			(row) => row.rowIndex === 1 || row.rowIndex === 2,
		);
		expect(keptRows).toHaveLength(2);

		for (const keptRow of keptRows) {
			Object.defineProperty(keptRow, "cells", {
				get(): never {
					throw new Error("Kept mounted row was scanned.");
				},
			});
		}

		expect(() => {
			runtime.syncSnapshot(scrolled, { start: 1, end: 3 });
		}).not.toThrow();
	});

	it("consumeMountedRowsChange returns false on same range recompute", () => {
		const runtime = createTwoHopMountRuntime();
		const range = { start: 0, end: 2 };
		runtime.buildMountedRows({
			rowModel,
			rowRange: range,
			ranges: { mounted: range, previewVisible: range },
		});
		// First build triggers change.
		expect(runtime.consumeMountedRowsChange()).toBe(true);

		// Same range recompute should not trigger change.
		runtime.buildMountedRows({
			rowModel,
			rowRange: range,
			ranges: { mounted: range, previewVisible: range },
		});
		expect(runtime.consumeMountedRowsChange()).toBe(false);
	});

	it("consumeMountedRowsChange returns true on range change", () => {
		const runtime = createTwoHopMountRuntime();
		const range = { start: 0, end: 2 };
		runtime.buildMountedRows({
			rowModel,
			rowRange: range,
			ranges: { mounted: range, previewVisible: range },
		});
		runtime.consumeMountedRowsChange();

		// Range change should trigger change.
		runtime.buildMountedRows({
			rowModel,
			rowRange: { start: 1, end: 3 },
			ranges: {
				mounted: { start: 1, end: 3 },
				previewVisible: { start: 1, end: 3 },
			},
		});
		expect(runtime.consumeMountedRowsChange()).toBe(true);
	});

	it("consumeMountedRowsChange returns true only once", () => {
		const runtime = createTwoHopMountRuntime();
		const range = { start: 0, end: 2 };
		runtime.buildMountedRows({
			rowModel,
			rowRange: range,
			ranges: { mounted: range, previewVisible: range },
		});
		expect(runtime.consumeMountedRowsChange()).toBe(true);
		// Second consume returns false.
		expect(runtime.consumeMountedRowsChange()).toBe(false);
	});

	it("getMountedRows returns the current row slices", () => {
		const runtime = createTwoHopMountRuntime();
		expect(runtime.getMountedRows()).toEqual([]);

		const range = { start: 0, end: 2 };
		const build = runtime.buildMountedRows({
			rowModel,
			rowRange: range,
			ranges: { mounted: range, previewVisible: range },
		});
		expect(runtime.getMountedRows()).toBe(build.rowSlices);
	});
});
