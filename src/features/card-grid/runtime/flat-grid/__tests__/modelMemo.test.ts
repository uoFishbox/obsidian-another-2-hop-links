import { describe, expect, it } from "vitest";
import type { FlatGridLayoutMetrics } from "ui/virtualization/public";
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
