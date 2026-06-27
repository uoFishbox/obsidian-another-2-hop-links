import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { VirtualNavigationTarget } from "ui/components/common/virtual-list/types";
import type { TwoHopVirtualListItem } from "../twoHopVirtualListModel";

export interface ResolveTwoHopNavigationTargetParams {
	readonly direction: ResultNavigationDirection;
	readonly currentPosition: { rowIndex: number; columnIndex: number };
	getRowCellCount(rowIndex: number): number;
	getRowTop(rowIndex: number): number;
	resolveCell(
		rowIndex: number,
		columnIndex: number,
	): VirtualListLogicalCell<TwoHopVirtualListItem> | null;
}

export function resolveTwoHopNavigationTarget(
	params: ResolveTwoHopNavigationTargetParams,
): VirtualNavigationTarget | null {
	let rowIndex = params.currentPosition.rowIndex;
	let columnIndex = params.currentPosition.columnIndex;
	if (params.direction === "up") rowIndex -= 1;
	if (params.direction === "down") rowIndex += 1;
	if (params.direction === "left") columnIndex -= 1;
	if (params.direction === "right") columnIndex += 1;
	if (columnIndex < 0) {
		rowIndex -= 1;
		columnIndex = params.getRowCellCount(rowIndex) - 1;
	}
	const currentRowCellCount = params.getRowCellCount(rowIndex);
	if (currentRowCellCount <= 0) return null;
	if (columnIndex >= currentRowCellCount) {
		if (params.direction !== "right") columnIndex = currentRowCellCount - 1;
		else {
			rowIndex += 1;
			columnIndex = 0;
		}
	}
	const cell = params.resolveCell(rowIndex, columnIndex);
	if (!cell) return null;
	return {
		key: cell.key,
		rowTop: params.getRowTop(rowIndex),
	};
}
