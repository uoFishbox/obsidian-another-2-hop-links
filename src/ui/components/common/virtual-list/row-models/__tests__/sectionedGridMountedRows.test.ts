import { describe, expect, it, vi } from "vitest";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type { VirtualListLogicalCell } from "../../logicalCell";
import type { SectionLayout } from "../../layout/viewPlanRowTypes";
import { logicalCellKey, sourceKey } from "../../types";
import {
	buildSectionedGridMountedRows,
	type SectionedGridMountedRowsBuild,
	type SectionedGridPlan,
	type SectionedGridResolvedRowScratch,
	type SectionedGridSectionPlan,
} from "../sectionedGridMountedRows";

interface TestSection {
	readonly id: string;
}

type TestItem = string;

type TestSectionPlan = SectionedGridSectionPlan<TestItem, TestSection>;

type TestMountedRowsBuild = SectionedGridMountedRowsBuild<
	TestItem,
	TestSection,
	TestPlan
>;

interface TestPlan extends SectionedGridPlan<TestItem, TestSection, TestSectionPlan> {
	readonly rowSectionIndexes: readonly number[];
	readonly logicalCellsBySection: readonly (readonly VirtualListLogicalCell<TestItem>[])[];
}

function createSectionLayout(
	sectionIndex: number,
	cellCount: number,
	rowCount: number,
): SectionLayout<TestItem, TestSection> {
	const section = { id: `section-${sectionIndex}` };
	const descriptor: SectionRenderDescriptor<TestItem, TestSection> = {
		section,
		sectionKey: section.id,
		title: section.id,
		sectionId: section.id,
		totalCount: cellCount,
		loadedCount: cellCount,
		getItems: () => [],
		headerProps: {},
	};
	return {
		descriptor,
		sectionIndex,
		sectionId: section.id,
		visibleCount: cellCount,
		showLoadMore: false,
		cellCount,
		rowCount,
		contentHeight: rowCount * 10,
		blockHeight: rowCount * 10,
		sectionTop: 0,
	};
}

function createPlan(rowCount = 3): TestPlan {
	const section: TestSectionPlan = {
		sectionIndex: 0,
		firstRowIndex: 0,
		rowCount,
		cellCount: rowCount,
		mountedLayout: createSectionLayout(0, rowCount, rowCount),
	};
	return {
		sections: [section],
		rowCount,
		columns: 1,
		rowGap: 0,
		rowSectionIndexes: Array.from({ length: rowCount }, () => 0),
		logicalCellsBySection: [
			Array.from(
				{ length: rowCount },
				(_, index) => ["a", "b", "c"][index] ?? `item-${index}`,
			).map((key, itemIndex) => ({
				kind: "item",
				key: logicalCellKey(key),
				sourceKey: sourceKey(key),
				item: key,
				itemIndex,
			})),
		],
	};
}

describe("buildSectionedGridMountedRows", () => {
	it("shares the bounded row-slot behavior used by flat grids", () => {
		const plan = createPlan(30);
		const buildRange = (
			rowRange: { start: number; end: number },
			previousBuild?: TestMountedRowsBuild,
		) =>
			buildSectionedGridMountedRows({
				plan,
				rowRange,
				previousBuild,
				findSectionIndexByRow: () => 0,
				resolveRowInSection: (_plan, sectionPlan, rowIndex) => ({
					rowIndexInSection: rowIndex - sectionPlan.firstRowIndex,
					sectionCellStartIndex: rowIndex,
					cellCount: 1,
					top: rowIndex * 10,
				}),
				readLogicalCellInSection: (source, sectionIndex, cellIndex) =>
					source.logicalCellsBySection[sectionIndex]?.[cellIndex] ?? null,
			});

		let build = buildRange({ start: 0, end: 10 });
		for (const range of [
			{ start: 9, end: 10 },
			{ start: 9, end: 19 },
			{ start: 18, end: 19 },
			{ start: 18, end: 28 },
		]) {
			build = buildRange(range, build);
			expect(build.poolCapacity).toBe(10);
			expect(Math.max(...build.rowSlices.map((row) => row.slotIndex ?? 0))).toBeLessThan(10);
		}
	});

	it("reuses same-plan previous rows before resolving their sections", () => {
		const plan = createPlan();
		const findSectionIndexByRow = vi.fn(() => {
			throw new Error("binary section lookup should not run");
		});
		const resolveInitialSectionIndexByRow = vi.fn(
			(plan: TestPlan, rowIndex: number) =>
				plan.rowSectionIndexes[rowIndex] ?? -1,
		);
		const resolvedRows: number[] = [];
		const resolveRowInSectionInto = vi.fn(
			(
				out: SectionedGridResolvedRowScratch,
				_plan: TestPlan,
				sectionPlan: TestSectionPlan,
				rowIndex: number,
			): boolean => {
				resolvedRows.push(rowIndex);
				if (sectionPlan.sectionIndex !== plan.rowSectionIndexes[rowIndex]) {
					return false;
				}
				out.rowIndexInSection = rowIndex - sectionPlan.firstRowIndex;
				out.sectionCellStartIndex = rowIndex - sectionPlan.firstRowIndex;
				out.cellCount = 1;
				out.top = rowIndex * 10;
				return true;
			},
		);
		const build = (
			rowRange: { start: number; end: number },
			previousBuild?: TestMountedRowsBuild,
		) =>
			buildSectionedGridMountedRows({
				plan,
				rowRange,
				previousBuild,
				findSectionIndexByRow,
				resolveInitialSectionIndexByRow,
				resolveRowInSection: () => null,
				resolveRowInSectionInto,
				readLogicalCellInSection: (plan, sectionIndex, sectionCellIndex) =>
					plan.logicalCellsBySection[sectionIndex]?.[sectionCellIndex] ??
					null,
			});

		const first = build({ start: 0, end: 2 });
		resolvedRows.length = 0;
		resolveRowInSectionInto.mockClear();
		resolveInitialSectionIndexByRow.mockClear();

		const scrolled = build({ start: 1, end: 3 }, first);

		expect(scrolled.rowSlices[0]).toBe(first.rowSlices[1]);
		expect(scrolled.rowSlices[1].rowIndex).toBe(2);
		expect(scrolled.mountedCellCount).toBe(2);
		expect(resolvedRows).toEqual([2]);
		expect(resolveRowInSectionInto).toHaveBeenCalledTimes(1);
		expect(resolveInitialSectionIndexByRow).toHaveBeenCalledWith(plan, 1);
		expect(findSectionIndexByRow).not.toHaveBeenCalled();
	});

	it("can omit renderBodyKey while retaining structured render body identity", () => {
		const plan = createPlan();
		const build = buildSectionedGridMountedRows({
			plan,
			rowRange: { start: 0, end: 1 },
			renderBodyKeyPolicy: "omit",
			findSectionIndexByRow: () => 0,
			resolveInitialSectionIndexByRow: () => 0,
			resolveRowInSection: (_plan, sectionPlan, rowIndex) => ({
				rowIndexInSection: rowIndex - sectionPlan.firstRowIndex,
				sectionCellStartIndex: rowIndex - sectionPlan.firstRowIndex,
				cellCount: 1,
				top: rowIndex * 10,
			}),
			readLogicalCellInSection: (plan, sectionIndex, sectionCellIndex) =>
				plan.logicalCellsBySection[sectionIndex]?.[sectionCellIndex] ?? null,
		});

		expect(build.cells[0]?.renderBodyKey).toBeUndefined();
		expect(build.cells[0]?.renderBodyKind).toBe("item");
		expect(build.cells[0]?.renderBodySectionId).toBe("section-0");
		expect(build.cells[0]?.renderBodySourceKey).toBe("a");
		expect(build.cells[0]?.renderBodyRevision).toBeNull();
	});
});
