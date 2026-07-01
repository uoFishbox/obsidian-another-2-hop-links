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

function createPlan(): TestPlan {
	const section: TestSectionPlan = {
		sectionIndex: 0,
		firstRowIndex: 0,
		rowCount: 3,
		cellCount: 3,
		mountedLayout: createSectionLayout(0, 3, 3),
	};
	return {
		sections: [section],
		rowCount: 3,
		columns: 1,
		rowGap: 0,
		rowSectionIndexes: [0, 0, 0],
		logicalCellsBySection: [
			["a", "b", "c"].map((key, itemIndex) => ({
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
});
