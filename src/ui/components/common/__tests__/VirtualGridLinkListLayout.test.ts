import { describe, expect, it, vi } from "vitest";
import {
	computeColumnCount,
	computeVirtualGridLayout,
	computeVisibleRowRange,
} from "ui/virtualization/layout/flatGridLayout";
import { createFlatLogicalCellSource } from "ui/virtualization/flatLogicalCellSource";

describe("linkListLayout", () => {
	describe("computeColumnCount", () => {
		it("always >=1 and <= maxColumns, falls back on negative value", () => {
			const widths = [-100, 50, 100, 200, 500, 1000, 2000];
			for (const w of widths) {
				const cols = computeColumnCount({
					containerWidth: w,
					minCellWidth: 100,
					gap: 10,
					maxColumns: 4,
				});
				expect(cols).toBeGreaterThanOrEqual(1);
				expect(cols).toBeLessThanOrEqual(4);
			}
		});
	});

	describe("computeVirtualGridLayout", () => {
		it("columns <= maxColumns, capacity >= cellCount", () => {
			const inputs = [
				{ containerWidth: 200, maxColumns: 2, cellCount: 7 },
				{ containerWidth: 500, maxColumns: 3, cellCount: 10 },
				{ containerWidth: 1200, maxColumns: 6, cellCount: 10 },
			];
			for (const input of inputs) {
				const layout = computeVirtualGridLayout({
					containerWidth: input.containerWidth,
					minCellWidth: 100,
					gap: 10,
					maxColumns: input.maxColumns,
					rowHeight: 120,
					cellCount: input.cellCount,
				});
				expect(layout.columns).toBeLessThanOrEqual(input.maxColumns);
				expect(layout.rowCount * layout.columns).toBeGreaterThanOrEqual(
					input.cellCount,
				);
			}
		});

		it("when cellCount=0, rowCount=0 and contentHeight=0", () => {
			const layout = computeVirtualGridLayout({
				containerWidth: 330,
				minCellWidth: 100,
				gap: 10,
				maxColumns: 4,
				rowHeight: 120,
				cellCount: 0,
			});
			expect(layout.rowCount).toBe(0);
			expect(layout.contentHeight).toBe(0);
		});
	});

	function collectCellsFromSource<T>(
		params: Parameters<typeof createFlatLogicalCellSource<T>>[0],
	) {
		const source = createFlatLogicalCellSource(params);
		const cells = [];
		for (let index = 0; index < source.cellCount; index += 1) {
			const cell = source.resolveCellAtIndex(index);
			if (cell) {
				cells.push(cell);
			}
		}
		return cells;
	}

	describe("buildLogicalCells", () => {
		it("header at start, load-more at end, itemIndex ascending", () => {
			const cells = collectCellsFromSource({
				header: true,
				items: ["A", "B", "C", "D"],
				visibleCount: 3,
				showLoadMore: true,
				getKey: (item) => item,
				sectionId: "demo",
			});
			expect(cells[0]?.kind).toBe("header");
			expect(cells[cells.length - 1]?.kind).toBe("load-more");

			const itemCells = cells.filter((c) => c.kind === "item");
			for (let i = 0; i < itemCells.length; i++) {
				const cell = itemCells[i];
				if (cell?.kind === "item") {
					expect(cell.itemIndex).toBe(i);
					expect(cell.sourceKey).toBe(cell.item);
				}
			}
		});

		it("capping by visibleCount and deduplication of duplicate keys", () => {
			const capped = collectCellsFromSource({
				header: false,
				items: ["A", "B", "C"],
				visibleCount: 2,
				showLoadMore: false,
				getKey: (item) => item,
				sectionId: "demo",
			});
			expect(capped.filter((c) => c.kind === "item").length).toBe(2);

			const withDups = collectCellsFromSource({
				header: false,
				items: ["A", "B", "C"],
				visibleCount: 3,
				showLoadMore: false,
				getKey: () => "dup",
				sectionId: "demo",
			});
			const keys = withDups.map((c) => c.key);
			expect(new Set(keys).size).toBe(keys.length);
		});

		it("keeps source keys separate from mounted item keys", () => {
			const cells = collectCellsFromSource({
				header: false,
				items: ["A"],
				visibleCount: 1,
				showLoadMore: false,
				getKey: () => "source-a",
				sectionId: "demo",
			});
			const item = cells[0];

			expect(item?.kind).toBe("item");
			if (item?.kind !== "item") {
				return;
			}
			expect(item.sourceKey).toBe("source-a");
			expect(item.key).toBe("source-a::item:0");
		});

		it("does not prefix scan when resolving key for far index", () => {
			const getKey = vi.fn((item: string) => item);
			const items = Array.from(
				{ length: 100_000 },
				(_, index) => `item-${index}`,
			);
			const source = createFlatLogicalCellSource({
				header: false,
				items,
				getKey,
				visibleCount: items.length,
				showLoadMore: false,
				sectionId: "demo",
			});

			expect(source.resolveLogicalCellKeyAtItemIndex(90_000)).toBe(
				"item-90000::item:90000",
			);
			expect(getKey).toHaveBeenCalledTimes(1);
			expect(getKey).toHaveBeenCalledWith("item-90000", 90_000);
		});

		it("items only without header/load-more", () => {
			const cells = collectCellsFromSource({
				header: false,
				items: ["A", "B"],
				visibleCount: 2,
				showLoadMore: false,
				getKey: (item) => item,
				sectionId: "demo",
			});
			expect(cells.length).toBe(2);
			expect(cells.every((c) => c.kind === "item")).toBe(true);
		});
	});

	describe("logical cell source", () => {
		it("returns null for out-of-range index", () => {
			const source = createFlatLogicalCellSource({
				header: false,
				items: ["A"],
				visibleCount: 1,
				showLoadMore: false,
				getKey: (item) => item,
				sectionId: "demo",
			});
			expect(source.resolveCellAtIndex(-1)).toBeNull();
			expect(source.resolveCellAtIndex(1)).toBeNull();

			const outOfBoundsSource = createFlatLogicalCellSource({
				header: true,
				items: ["A", "B", "C"],
				visibleCount: 2,
				showLoadMore: true,
				getKey: (item) => item,
				sectionId: "demo",
			});
			expect(outOfBoundsSource.resolveCellAtIndex(4)).toBeNull();
		});
	});

	describe("computeVisibleRowRange", () => {
		it("start <= end, within bounds, overscan reflected", () => {
			const noOverscan = computeVisibleRowRange({
				scrollTop: 350,
				viewportHeight: 220,
				sectionTop: 300,
				rowHeight: 100,
				gap: 10,
				rowCount: 10,
				overscanRows: 0,
			});
			expect(noOverscan.start).toBeLessThanOrEqual(noOverscan.end);
			expect(noOverscan.start).toBeGreaterThanOrEqual(0);
			expect(noOverscan.end).toBeLessThanOrEqual(10);

			const withOverscan = computeVisibleRowRange({
				scrollTop: 350,
				viewportHeight: 220,
				sectionTop: 300,
				rowHeight: 100,
				gap: 10,
				rowCount: 10,
				overscanRows: 3,
			});
			expect(withOverscan.start).toBeLessThanOrEqual(noOverscan.start);
			expect(withOverscan.end).toBeGreaterThanOrEqual(noOverscan.end);
		});

		it("empty range when rowCount=0 or outside viewport", () => {
			const empty = computeVisibleRowRange({
				scrollTop: 0,
				viewportHeight: 200,
				sectionTop: 0,
				rowHeight: 100,
				gap: 10,
				rowCount: 0,
				overscanRows: 2,
			});
			expect(empty.start).toBe(empty.end);

			const outside = computeVisibleRowRange({
				scrollTop: 0,
				viewportHeight: 200,
				sectionTop: 400,
				rowHeight: 100,
				gap: 10,
				rowCount: 10,
				overscanRows: 2,
			});
			expect(outside.start).toBe(outside.end);
		});
	});
});
