import { describe, expect, it } from "vitest";
import {
	createTwoHopSectionModel,
	type TwoHopSectionModel,
} from "two-hop/ui/twoHopSectionModel";
import {
	resolveTwoHopNavigationTarget,
	resolveTwoHopSequentialNavigationTarget,
	shouldMoveFocusAboveTwoHopGrid,
	type TwoHopNavigationCell,
	type TwoHopNavigationGrid,
} from "../navigation";

const plainSection = createTwoHopSectionModel({
	id: "section",
	kind: "new-links-section",
	title: "Section",
	items: [],
	totalCount: 0,
});

const clickableSection = createTwoHopSectionModel({
	id: "clickable",
	kind: "new-links-section",
	title: "Clickable",
	headerProps: { onClick: () => {} },
	items: [],
	totalCount: 0,
});

function createCell(
	section: TwoHopSectionModel,
	kind: TwoHopNavigationCell["kind"],
	rowIndex: number,
	columnIndex: number,
	logicalKey: string,
): TwoHopNavigationCell {
	return { section, kind, rowIndex, columnIndex, logicalKey };
}

function createGrid(
	rows: readonly (readonly TwoHopNavigationCell[])[],
): TwoHopNavigationGrid<TwoHopNavigationCell> {
	return {
		rowCount: rows.length,
		getRow(rowIndex) {
			const cells = rows[rowIndex];
			if (!cells) return null;
			return {
				top: rowIndex * 100,
				cellCount: cells.length,
				getCell: (columnIndex) => cells[columnIndex] ?? null,
			};
		},
	};
}

describe("two-hop navigation policy", () => {
	it("skips non-focusable headers when navigating sequentially", () => {
		const grid = createGrid([
			[
				createCell(plainSection, "header", 0, 0, "header"),
				createCell(plainSection, "item", 0, 1, "a"),
			],
			[createCell(plainSection, "item", 1, 0, "b")],
		]);

		expect(
			resolveTwoHopSequentialNavigationTarget(grid, "a", "forward", {
				rowIndex: 0,
				columnIndex: 1,
			})?.cell.logicalKey,
		).toBe("b");
		expect(
			resolveTwoHopSequentialNavigationTarget(grid, "b", "backward", {
				rowIndex: 1,
				columnIndex: 0,
			})?.cell.logicalKey,
		).toBe("a");
	});

	it("treats a clickable header as sequentially focusable", () => {
		const grid = createGrid([
			[
				createCell(plainSection, "item", 0, 0, "a"),
				createCell(clickableSection, "header", 0, 1, "clickable-header"),
			],
		]);

		expect(
			resolveTwoHopSequentialNavigationTarget(grid, "a", "forward", {
				rowIndex: 0,
				columnIndex: 0,
			})?.cell.logicalKey,
		).toBe("clickable-header");
	});

	it("wraps horizontal navigation across rows", () => {
		const grid = createGrid([
			[
				createCell(plainSection, "item", 0, 0, "a"),
				createCell(plainSection, "item", 0, 1, "b"),
			],
			[createCell(plainSection, "item", 1, 0, "c")],
		]);

		expect(
			resolveTwoHopNavigationTarget(grid, "b", "right", {
				rowIndex: 0,
				columnIndex: 1,
			}),
		).toEqual({
			cell: expect.objectContaining({ logicalKey: "c" }),
			rowTop: 100,
		});
		expect(
			resolveTwoHopNavigationTarget(grid, "c", "left", {
				rowIndex: 1,
				columnIndex: 0,
			})?.cell.logicalKey,
		).toBe("b");
	});

	it("moves focus above the grid only from its first item row", () => {
		const grid = createGrid([
			[
				createCell(plainSection, "header", 0, 0, "header"),
				createCell(plainSection, "item", 0, 1, "first"),
			],
			[createCell(plainSection, "item", 1, 0, "second")],
		]);
		const firstPosition = { rowIndex: 0, columnIndex: 1 };

		expect(shouldMoveFocusAboveTwoHopGrid(grid, "first", firstPosition)).toBe(true);
		expect(
			shouldMoveFocusAboveTwoHopGrid(grid, "second", {
				rowIndex: 1,
				columnIndex: 0,
			}),
		).toBe(false);
		expect(
			shouldMoveFocusAboveTwoHopGrid(grid, "header", {
				rowIndex: 0,
				columnIndex: 0,
			}),
		).toBe(false);
		expect(shouldMoveFocusAboveTwoHopGrid(grid, "stale", firstPosition)).toBe(
			false,
		);
	});
});
