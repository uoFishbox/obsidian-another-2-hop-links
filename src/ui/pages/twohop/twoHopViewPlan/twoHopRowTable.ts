import type { TwoHopRowPlan, TwoHopRowTable, TwoHopViewPlan } from "./types";
/**
 * Reads a row-table entry as a `TwoHopRowPlan` snapshot, or null when the
 * row index is out of range.
 */
function readTwoHopRowTableAt(
	table: TwoHopRowTable,
	rowIndex: number,
): TwoHopRowPlan | null {
	if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
	return {
		sectionIndex: table.sectionIndexByRow[rowIndex],
		rowIndexInSection: table.rowIndexInSectionByRow[rowIndex],
		sectionCellStartIndex: table.sectionCellStartByRow[rowIndex],
		cellCount: table.cellCountByRow[rowIndex],
		top: table.topByRow[rowIndex],
	};
}

/**
 * Builds the `plan.rows` facade: a read-only, index-access-only view over a
 * row table that materializes `TwoHopRowPlan` snapshots on demand.
 */
export function createTwoHopRowPlanFacade(
	table: TwoHopRowTable,
): readonly TwoHopRowPlan[] {
	return new Proxy([] as TwoHopRowPlan[], {
		get(_target, prop): unknown {
			if (prop === "length") return table.rowCount;
			if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
				return readTwoHopRowTableAt(table, Number(prop));
			}
			return undefined;
		},
	});
}
/**
 * Reads a compiled row plan entry, or null when the row index is out of range.
 */
export function readTwoHopRowPlan(
	plan: TwoHopViewPlan,
	rowIndex: number,
): TwoHopRowPlan | null {
	return readTwoHopRowTableAt(plan.rowTable, rowIndex);
}
