import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type {
	TwoHopProgressiveCell,
	TwoHopProgressivePlan,
} from "features/two-hop/ui/twoHopProgressivePlan";
import { resolveTwoHopProgressiveCell } from "features/two-hop/ui/twoHopProgressivePlan";
import {
	resolveSectionIndexForRow,
	resolveTwoHopRowTop,
} from "features/two-hop/ui/viewport/twoHopGeometry";

export interface TwoHopProgressiveNavigationTarget {
	readonly key: string;
	readonly rowIndex: number;
	readonly rowTop: number;
}

/** Resolves keyboard navigation against the complete plan, including unmounted rows. */
export function resolveTwoHopProgressiveNavigationTarget(
	plan: TwoHopProgressivePlan,
	currentKey: string,
	direction: ResultNavigationDirection,
	currentPosition: { readonly rowIndex: number; readonly columnIndex: number },
): TwoHopProgressiveNavigationTarget | null {
	const currentCell = resolveCell(plan, currentPosition);
	if (!currentCell || currentCell.logicalKey !== currentKey) return null;

	const target =
		direction === "left" || direction === "right"
			? resolveHorizontalTarget(plan, currentPosition, direction)
			: resolveVerticalTarget(plan, currentPosition, direction);
	if (!target) return null;

	return {
		key: target.logicalKey,
		rowIndex: target.rowIndex,
		rowTop: resolveTwoHopRowTop(plan.geometry, target.rowIndex),
	};
}

function resolveHorizontalTarget(
	plan: TwoHopProgressivePlan,
	currentPosition: { readonly rowIndex: number; readonly columnIndex: number },
	direction: "left" | "right",
): TwoHopProgressiveCell | null {
	const step = direction === "left" ? -1 : 1;
	for (
		let columnIndex = currentPosition.columnIndex + step;
		columnIndex >= 0 && columnIndex < plan.geometry.columns;
		columnIndex += step
	) {
		const cell = resolveCell(plan, {
			rowIndex: currentPosition.rowIndex,
			columnIndex,
		});
		if (cell && isFocusableCell(cell)) return cell;
	}
	return null;
}

function resolveVerticalTarget(
	plan: TwoHopProgressivePlan,
	currentPosition: { readonly rowIndex: number; readonly columnIndex: number },
	direction: "up" | "down",
): TwoHopProgressiveCell | null {
	const step = direction === "up" ? -1 : 1;
	let fallback: TwoHopProgressiveCell | null = null;
	for (
		let rowIndex = currentPosition.rowIndex + step;
		rowIndex >= 0 && rowIndex < plan.totalRowCount;
		rowIndex += step
	) {
		for (
			let columnIndex = 0;
			columnIndex < plan.geometry.columns;
			columnIndex += 1
		) {
			const cell = resolveCell(plan, { rowIndex, columnIndex });
			if (!cell || !isFocusableCell(cell)) continue;
			if (columnIndex === currentPosition.columnIndex) return cell;
			if (!fallback) fallback = cell;
		}
	}
	return fallback;
}

function resolveCell(
	plan: TwoHopProgressivePlan,
	position: { readonly rowIndex: number; readonly columnIndex: number },
): TwoHopProgressiveCell | null {
	const sectionIndex = resolveSectionIndexForRow(plan.geometry, position.rowIndex);
	if (sectionIndex < 0) return null;
	const section = plan.sections[sectionIndex];
	if (!section) return null;
	const rowInSection =
		position.rowIndex - plan.geometry.firstRowBySection[sectionIndex];
	const cellIndex = rowInSection * plan.geometry.columns + position.columnIndex;
	return resolveTwoHopProgressiveCell(
		section,
		position.rowIndex,
		position.columnIndex,
		cellIndex,
	);
}

function isFocusableCell(cell: TwoHopProgressiveCell): boolean {
	return (
		cell.kind !== "header" || cell.section.header.props.interactionId !== undefined
	);
}
