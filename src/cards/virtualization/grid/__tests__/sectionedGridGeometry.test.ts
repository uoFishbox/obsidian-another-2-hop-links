import { describe, expect, it } from "vitest";
import { createSectionedGridGeometry } from "../layout";

describe("sectionedGridGeometry", () => {
	it("represents a flat grid as one section without trailing spacing", () => {
		const geometry = createSectionedGridGeometry({
			sectionCellCounts: [8],
			columns: 3,
			rowHeight: 100,
			gap: 10,
			sectionMarginBottom: 0,
		});

		expect(geometry.rowCount).toBe(3);
		expect(geometry.totalHeight).toBe(320);
		expect(geometry.resolveRow(2)).toEqual({
			sectionIndex: 0,
			rowInSection: 2,
			firstCellIndexInSection: 6,
			cellCount: 2,
			top: 220,
		});
	});

	it("starts every section on a new row and replaces the final row gap with section spacing", () => {
		const geometry = createSectionedGridGeometry({
			sectionCellCounts: [4, 1],
			columns: 2,
			rowHeight: 100,
			gap: 10,
			sectionMarginBottom: 30,
		});

		expect(geometry.rowCount).toBe(3);
		expect(geometry.totalHeight).toBe(370);
		expect(geometry.resolveRow(2)?.top).toBe(240);
		expect(geometry.resolveCellPosition(1, 0)).toEqual({
			rowIndex: 2,
			columnIndex: 0,
		});
	});

	it("does not allocate rows or spacing for empty sections", () => {
		const geometry = createSectionedGridGeometry({
			sectionCellCounts: [0, 3, 0, 1],
			columns: 2,
			rowHeight: 50,
			gap: 5,
			sectionMarginBottom: 20,
		});

		expect(geometry.rowCount).toBe(3);
		expect(geometry.totalHeight).toBe(195);
		expect(geometry.resolveRow(0)?.sectionIndex).toBe(1);
		expect(geometry.resolveRow(2)?.sectionIndex).toBe(3);
		expect(geometry.resolveCellPosition(0, 0)).toBeNull();
	});

	it("resolves strict row boundaries across section margins", () => {
		const geometry = createSectionedGridGeometry({
			sectionCellCounts: [3, 2],
			columns: 2,
			rowHeight: 100,
			gap: 10,
			sectionMarginBottom: 10,
		});

		expect(geometry.resolveFirstRowEndingAfter(100)).toBe(1);
		expect(geometry.resolveFirstRowStartingAtOrAfter(110)).toBe(1);
		expect(geometry.resolveFirstRowEndingAfter(220)).toBe(2);
		expect(geometry.resolveFirstRowStartingAtOrAfter(220)).toBe(2);
		expect(geometry.resolveFirstRowEndingAfter(320)).toBe(3);
	});
});
