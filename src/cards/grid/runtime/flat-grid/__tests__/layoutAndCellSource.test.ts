import { describe, expect, it, vi } from "vitest";
import { computeColumnCount, computeFlatGridLayout } from "cards/virtualization/public";
import { createFlatGridCellSource } from "../cellSource";

describe("flat card-grid layout and cell source", () => {
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

	describe("computeFlatGridLayout", () => {
		it("columns <= maxColumns, capacity >= cellCount", () => {
			const inputs = [
				{ containerWidth: 200, maxColumns: 2, cellCount: 7 },
				{ containerWidth: 500, maxColumns: 3, cellCount: 10 },
				{ containerWidth: 1200, maxColumns: 6, cellCount: 10 },
			];
			for (const input of inputs) {
				const layout = computeFlatGridLayout({
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
			const layout = computeFlatGridLayout({
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
		params: Parameters<typeof createFlatGridCellSource<T>>[0],
	) {
		const source = createFlatGridCellSource(params);
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
				getItemId: (item) => item,
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

		it("caps by visibleCount and rejects duplicate item ids", () => {
			const capped = collectCellsFromSource({
				header: false,
				items: ["A", "B", "C"],
				visibleCount: 2,
				showLoadMore: false,
				getItemId: (item) => item,
				sectionId: "demo",
			});
			expect(capped.filter((c) => c.kind === "item").length).toBe(2);

			expect(() =>
				collectCellsFromSource({
					header: false,
					items: ["A", "B", "C"],
					visibleCount: 3,
					showLoadMore: false,
					getItemId: () => "dup",
					sectionId: "demo",
				}),
			).toThrow(/item id must be unique/);
		});

		it("keeps source keys separate from mounted item keys", () => {
			const cells = collectCellsFromSource({
				header: false,
				items: ["A"],
				visibleCount: 1,
				showLoadMore: false,
				getItemId: () => "source-a",
				sectionId: "demo",
			});
			const item = cells[0];

			expect(item?.kind).toBe("item");
			if (item?.kind !== "item") {
				return;
			}
			expect(item.sourceKey).toBe("source-a");
			expect(item.key).toBe("flat:4:demo:item:8:source-a");
		});

		it("does not prefix scan when resolving key for far index", () => {
			const getItemId = vi.fn((item: string) => item);
			const items = Array.from(
				{ length: 100_000 },
				(_, index) => `item-${index}`,
			);
			const source = createFlatGridCellSource({
				header: false,
				items,
				getItemId,
				visibleCount: items.length,
				showLoadMore: false,
				sectionId: "demo",
			});

			expect(source.resolveLogicalCellKeyAtItemIndex(90_000)).toBe(
				"flat:4:demo:item:10:item-90000",
			);
			expect(getItemId).toHaveBeenCalledTimes(1);
			expect(getItemId).toHaveBeenCalledWith("item-90000", 90_000);
		});

		it("items only without header/load-more", () => {
			const cells = collectCellsFromSource({
				header: false,
				items: ["A", "B"],
				visibleCount: 2,
				showLoadMore: false,
				getItemId: (item) => item,
				sectionId: "demo",
			});
			expect(cells.length).toBe(2);
			expect(cells.every((c) => c.kind === "item")).toBe(true);
		});
	});

	describe("logical cell source", () => {
		it("returns null for out-of-range index", () => {
			const source = createFlatGridCellSource({
				header: false,
				items: ["A"],
				visibleCount: 1,
				showLoadMore: false,
				getItemId: (item) => item,
				sectionId: "demo",
			});
			expect(source.resolveCellAtIndex(-1)).toBeNull();
			expect(source.resolveCellAtIndex(1)).toBeNull();

			const outOfBoundsSource = createFlatGridCellSource({
				header: true,
				items: ["A", "B", "C"],
				visibleCount: 2,
				showLoadMore: true,
				getItemId: (item) => item,
				sectionId: "demo",
			});
			expect(outOfBoundsSource.resolveCellAtIndex(4)).toBeNull();
		});
	});
});
