import { describe, expect, it } from "vitest";
import type { FlatGridLayoutMetrics } from "../../layoutMetrics";
import { createFlatVirtualGridRuntimeModel } from "../flatVirtualGridRuntimeModel";

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

describe("flatVirtualGridRuntimeModel", () => {
	it("reuses the logical cell source while declared content inputs are stable", () => {
		const runtime = createFlatVirtualGridRuntimeModel<string>();
		const dataSource = runtime.createDataSource({
			items: ["a", "b"],
			getKey: (item) => item,
		});
		const first = runtime.resolveLogicalCellSource({
			dataSource,
			visibleCount: 2,
			hasHeader: false,
			showLoadMore: false,
		});
		const second = runtime.resolveLogicalCellSource({
			dataSource,
			visibleCount: 2,
			hasHeader: false,
			showLoadMore: false,
		});

		expect(second).toBe(first);
	});

	it("invalidates the logical cell source when the visible shape changes", () => {
		const runtime = createFlatVirtualGridRuntimeModel<string>();
		const dataSource = runtime.createDataSource({
			items: ["a", "b"],
			getKey: (item) => item,
		});
		const first = runtime.resolveLogicalCellSource({
			dataSource,
			visibleCount: 1,
			hasHeader: false,
			showLoadMore: true,
		});
		const second = runtime.resolveLogicalCellSource({
			dataSource,
			visibleCount: 2,
			hasHeader: false,
			showLoadMore: false,
		});

		expect(second).not.toBe(first);
	});

	it("reuses the row model for an equivalent layout key", () => {
		const runtime = createFlatVirtualGridRuntimeModel<string>();
		const dataSource = runtime.createDataSource({
			items: ["a", "b"],
			getKey: (item) => item,
		});
		const cellSource = runtime.resolveLogicalCellSource({
			dataSource,
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
		const runtime = createFlatVirtualGridRuntimeModel<string>();
		const dataSource = runtime.createDataSource({
			items: ["a", "b"],
			getKey: (item) => item,
		});
		const cellSource = runtime.resolveLogicalCellSource({
			dataSource,
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
