import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualNavigationTarget } from "ui/virtualization/types";
import {
	resolveTwoHopCell,
	resolveTwoHopRowTop,
	type TwoHopGeometry,
	type TwoHopResolvedCell,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import type { TwoHopDocument } from "features/two-hop/ui/twoHopDocument";

export interface TwoHopInteractionRouter {
	resolveNavigationTarget(
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: { readonly rowIndex: number; readonly columnIndex: number },
	): VirtualNavigationTarget | null;
}

export function createTwoHopInteractionRouter(params: {
	readonly getDocument: () => TwoHopDocument;
	readonly getGeometry: () => TwoHopGeometry;
}): TwoHopInteractionRouter {
	function resolveNavigationTarget(
		_currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: { readonly rowIndex: number; readonly columnIndex: number },
	): VirtualNavigationTarget | null {
		const document = params.getDocument();
		const geometry = params.getGeometry();
		const cell = resolveDirectionalCell(
			document,
			geometry,
			direction,
			currentPosition.rowIndex,
			currentPosition.columnIndex,
		);
		if (!cell) return null;
		return {
			key: resolveTwoHopNavigationCellKey(cell),
			rowTop: resolveTwoHopRowTop(geometry, cell.rowIndex),
		};
	}

	return { resolveNavigationTarget };
}

export function resolveTwoHopNavigationCellKey(cell: TwoHopResolvedCell): string {
	return cell.logicalKey;
}

function resolveDirectionalCell(
	document: TwoHopDocument,
	geometry: TwoHopGeometry,
	direction: ResultNavigationDirection,
	rowIndex: number,
	columnIndex: number,
): TwoHopResolvedCell | null {
	const rowStep = direction === "up" ? -1 : direction === "down" ? 1 : 0;
	if (rowStep !== 0) {
		for (
			let nextRow = rowIndex + rowStep;
			nextRow >= 0 && nextRow < geometry.rowCount;
			nextRow += rowStep
		) {
			const sameColumn = resolveTwoHopCell(
				document,
				geometry,
				nextRow,
				columnIndex,
			);
			if (sameColumn) return sameColumn;
			for (
				let fallbackColumn = geometry.columns - 1;
				fallbackColumn >= 0;
				fallbackColumn -= 1
			) {
				const fallback = resolveTwoHopCell(
					document,
					geometry,
					nextRow,
					fallbackColumn,
				);
				if (fallback) return fallback;
			}
		}
		return null;
	}

	const linearStep = direction === "left" ? -1 : 1;
	let linearIndex = rowIndex * geometry.columns + columnIndex + linearStep;
	const linearEnd = geometry.rowCount * geometry.columns;
	while (linearIndex >= 0 && linearIndex < linearEnd) {
		const nextRow = Math.floor(linearIndex / geometry.columns);
		const nextColumn = linearIndex % geometry.columns;
		const cell = resolveTwoHopCell(document, geometry, nextRow, nextColumn);
		if (cell) return cell;
		linearIndex += linearStep;
	}
	return null;
}
