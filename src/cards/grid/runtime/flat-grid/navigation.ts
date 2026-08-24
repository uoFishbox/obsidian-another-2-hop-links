import type { FlatGridLogicalCell } from "./logicalCell";
import type {
	VirtualNavigationDirection,
	VirtualNavigationTarget,
	VirtualRowModel,
} from "cards/virtualization/public";

export function resolveFlatVirtualNavigationTarget<T>(params: {
	rowModel: VirtualRowModel<FlatGridLogicalCell<T>>;
	cellCount: number;
	resolveCellAtIndex(index: number): FlatGridLogicalCell<T> | null;
	currentKey: string;
	direction: VirtualNavigationDirection;
	currentPosition: {
		rowIndex: number;
		columnIndex: number;
	};
}): VirtualNavigationTarget | null {
	const columns = Math.max(1, params.rowModel.layout.columns);
	const currentIndex =
		params.currentPosition.rowIndex * columns + params.currentPosition.columnIndex;
	const currentCell = params.resolveCellAtIndex(currentIndex);
	if (!currentCell || currentCell.key !== params.currentKey) {
		return null;
	}

	const currentRow = params.currentPosition.rowIndex;
	let targetIndex: number | null = null;

	switch (params.direction) {
		case "up":
			targetIndex = currentIndex - columns >= 0 ? currentIndex - columns : null;
			break;
		case "down":
			targetIndex =
				currentIndex + columns < params.cellCount
					? currentIndex + columns
					: null;
			break;
		case "left":
			targetIndex =
				params.currentPosition.columnIndex > 0 ? currentIndex - 1 : null;
			break;
		case "right": {
			const nextIndex = currentIndex + 1;
			targetIndex =
				nextIndex < params.cellCount &&
				Math.floor(nextIndex / columns) === currentRow
					? nextIndex
					: null;
			break;
		}
	}

	if (targetIndex === null) {
		return null;
	}

	const targetCell = params.resolveCellAtIndex(targetIndex);
	if (!targetCell) {
		return null;
	}

	const targetRowIndex = Math.floor(targetIndex / columns);
	const targetRow = params.rowModel.getRow(targetRowIndex);
	if (!targetRow) {
		return null;
	}

	return {
		key: targetCell.key,
		rowTop: targetRow.top,
	};
}
