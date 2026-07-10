import type {
	TwoHopRowPlan,
	TwoHopSectionTable,
	TwoHopViewPlan,
} from "./types";

interface TwoHopRowGeometrySource {
	readonly sectionTable: TwoHopSectionTable;
	readonly rowCount: number;
	readonly columns: number;
	readonly rowHeight: number;
	readonly rowGap: number;
}

export function findTwoHopSectionIndexByRow(
	sectionTable: TwoHopSectionTable,
	rowIndex: number,
): number {
	if (rowIndex < 0 || sectionTable.sectionCount === 0) return -1;
	let low = 0;
	let high = sectionTable.sectionCount;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sectionTable.firstRowIndexBySection[mid] > rowIndex) high = mid;
		else low = mid + 1;
	}
	const sectionIndex = low - 1;
	if (
		sectionIndex < 0 ||
		rowIndex >=
			sectionTable.firstRowIndexBySection[sectionIndex] +
				sectionTable.rowCountBySection[sectionIndex]
	) {
		return -1;
	}
	return sectionIndex;
}

function readRow(source: TwoHopRowGeometrySource, rowIndex: number): TwoHopRowPlan | null {
	if (rowIndex < 0 || rowIndex >= source.rowCount) return null;
	const sectionIndex = findTwoHopSectionIndexByRow(source.sectionTable, rowIndex);
	if (sectionIndex < 0) return null;
	const rowIndexInSection =
		rowIndex - source.sectionTable.firstRowIndexBySection[sectionIndex];
	const sectionCellStartIndex = rowIndexInSection * source.columns;
	return {
		sectionIndex,
		rowIndexInSection,
		sectionCellStartIndex,
		cellCount: Math.min(
			source.columns,
			source.sectionTable.cellCountBySection[sectionIndex] -
				sectionCellStartIndex,
		),
		top:
			source.sectionTable.topBySection[sectionIndex] +
			rowIndexInSection * (source.rowHeight + source.rowGap),
	};
}

export function createTwoHopRowPlanFacade(
	source: TwoHopRowGeometrySource,
): readonly TwoHopRowPlan[] {
	return new Proxy([] as TwoHopRowPlan[], {
		get(_target, prop): unknown {
			if (prop === "length") return source.rowCount;
			if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
				return readRow(source, Number(prop));
			}
			return undefined;
		},
	});
}

export function readTwoHopRowPlan(
	plan: TwoHopViewPlan,
	rowIndex: number,
): TwoHopRowPlan | null {
	return readRow(plan, rowIndex);
}
