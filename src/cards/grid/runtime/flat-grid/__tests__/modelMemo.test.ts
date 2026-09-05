import { describe, expect, it } from "vitest";
import type { FlatGridLayoutMetrics } from "cards/virtualization/public";
import { createFlatGridModelMemo } from "../modelMemo";

const layout: FlatGridLayoutMetrics = {
	containerWidth: 640,
	columns: 3,
	cellWidth: 200,
	gap: 12,
	rowHeight: 120,
	rowCount: 1,
	rowStride: 132,
	contentHeight: 120,
};

describe("flat-grid model memo", () => {
	it("detects array and resolver replacements even with unchanged revision tokens", () => {
		const runtime = createFlatGridModelMemo<string>();
		const params = {
			items: ["old"],
			getItemId: (item: string) => item,
			itemsRevision: 0,
			itemIdRevision: 0,
			visibleCount: 1,
			hasHeader: false,
			showLoadMore: false,
		};
		const first = runtime.resolveLogicalCellSource(params);
		const replaced = { ...params, items: ["new"] };
		const second = runtime.resolveLogicalCellSource(replaced);
		expect(second.resolveCellAtIndex(0)).toMatchObject({ item: "new" });
		expect(second).not.toBe(first);
		expect(second.slotBindingRevision).toBe(first.slotBindingRevision);
		expect(runtime.resolveLogicalCellSource(replaced)).toBe(second);
		const third = runtime.resolveLogicalCellSource({
			...replaced,
			getItemId: (item: string) => `changed:${item}`,
		});
		expect(third.resolveSourceKeyAtItemIndex(0)).toBe("changed:new");
		expect(third).not.toBe(second);
	});

	it("detects in-place mutations through independent revision tokens", () => {
		const runtime = createFlatGridModelMemo<string>();
		let prefix = "first:";
		const params = {
			items: ["old"],
			getItemId: (item: string) => prefix + item,
			itemsRevision: 0,
			itemIdRevision: 0,
			visibleCount: 1,
			hasHeader: false,
			showLoadMore: false,
		};
		const first = runtime.resolveLogicalCellSource(params);
		expect(first.resolveSourceKeyAtItemIndex(0)).toBe("first:old");
		params.items[0] = "new";
		params.itemsRevision += 1;
		const second = runtime.resolveLogicalCellSource(params);
		expect(second.resolveCellAtIndex(0)).toMatchObject({ item: "new" });
		prefix = "second:";
		params.itemIdRevision += 1;
		const third = runtime.resolveLogicalCellSource(params);
		expect(third.resolveSourceKeyAtItemIndex(0)).toBe("second:new");
	});

	it("reuses the logical cell source while declared content inputs are stable", () => {
		const runtime = createFlatGridModelMemo<string>();
		const items = ["a", "b"];
		const getItemId = (item: string) => item;
		const first = runtime.resolveLogicalCellSource({
			items,
			getItemId,
			visibleCount: 2,
			hasHeader: false,
			showLoadMore: false,
		});
		const second = runtime.resolveLogicalCellSource({
			items,
			getItemId,
			visibleCount: 2,
			hasHeader: false,
			showLoadMore: false,
		});

		expect(second).toBe(first);
	});

	it("invalidates the logical cell source when the visible shape changes", () => {
		const runtime = createFlatGridModelMemo<string>();
		const items = ["a", "b"];
		const getItemId = (item: string) => item;
		const first = runtime.resolveLogicalCellSource({
			items,
			getItemId,
			visibleCount: 1,
			hasHeader: false,
			showLoadMore: true,
		});
		const second = runtime.resolveLogicalCellSource({
			items,
			getItemId,
			visibleCount: 2,
			hasHeader: false,
			showLoadMore: false,
		});

		expect(second).not.toBe(first);
		expect(second.slotBindingRevision).toBe(first.slotBindingRevision);
	});

	it("invalidates the binding topology when the item collection changes", () => {
		const runtime = createFlatGridModelMemo<string>();
		const getItemId = (item: string) => item;
		const first = runtime.resolveLogicalCellSource({
			items: ["a", "b"],
			getItemId,
			visibleCount: 2,
			hasHeader: false,
			showLoadMore: false,
		});
		const second = runtime.resolveLogicalCellSource({
			items: ["b"],
			getItemId,
			visibleCount: 1,
			hasHeader: false,
			showLoadMore: false,
		});

		expect(second.slotBindingRevision).not.toBe(first.slotBindingRevision);
	});

	it("reuses the row model for an equivalent layout key", () => {
		const runtime = createFlatGridModelMemo<string>();
		const cellSource = runtime.resolveLogicalCellSource({
			items: ["a", "b"],
			getItemId: (item) => item,
			visibleCount: 2,
			hasHeader: false,
			showLoadMore: false,
		});
		const first = runtime.resolveRowModel({ cellSource, layout });
		const second = runtime.resolveRowModel({
			cellSource,
			layout: { ...layout },
		});

		expect(second).toBe(first);
	});

	it("invalidates the row model when a layout-key field changes", () => {
		const runtime = createFlatGridModelMemo<string>();
		const cellSource = runtime.resolveLogicalCellSource({
			items: ["a", "b"],
			getItemId: (item) => item,
			visibleCount: 2,
			hasHeader: false,
			showLoadMore: false,
		});
		const first = runtime.resolveRowModel({ cellSource, layout });
		const second = runtime.resolveRowModel({
			cellSource,
			layout: {
				...layout,
				cellWidth: layout.cellWidth + 1,
			},
		});

		expect(second).not.toBe(first);
	});
});
