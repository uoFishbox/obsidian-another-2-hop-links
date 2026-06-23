import type { RowRange } from "../rowRange";
import type { VirtualListLogicalCell } from "../logicalCell";
import type { FlatRow, SectionLayout } from "../layout/viewPlanRowTypes";
import {
	canReuseMountedFlatCellContent,
	createMountedFlatCell,
	updateMountedFlatCell,
	type MountedFlatCell,
} from "../reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "../reconciliation/viewPlanRenderRows";
import {
	getViewPlanRenderBodyIdentityFields,
	resolveStableViewPlanRenderBodyKey,
} from "../reconciliation/renderBodyRevision";

export interface SectionedGridSectionPlan<T, G> {
	readonly sectionIndex: number;
	readonly firstRowIndex: number;
	readonly rowCount: number;
	readonly cellCount: number;
	readonly mountedLayout: SectionLayout<T, G>;
}

export interface SectionedGridPlan<
	T,
	G,
	TSection extends SectionedGridSectionPlan<T, G>,
> {
	readonly sections: readonly TSection[];
	readonly rowCount: number;
	readonly columns: number;
	readonly rowGap: number;
	readonly materializationRevision?: number;
}

export interface SectionedGridResolvedRow {
	readonly rowIndexInSection: number;
	readonly sectionCellStartIndex: number;
	readonly cellCount: number;
	readonly top: number;
}

export interface SectionedGridMountedRowsBuild<T, G, TPlan> {
	readonly cells: MountedFlatCell<T, G>[];
	readonly rowSlices: MountedFlatRowSlice<T, G>[];
	readonly reusableCellsByKey: Map<string, MountedFlatCell<T, G>>;
	readonly mountedCellCount: number;
	readonly nextRenderSlotIndex: number;
	readonly rowRange: RowRange;
	readonly plan: TPlan;
	readonly materializationRevision: number | undefined;
}

export interface BuildSectionedGridMountedRowsParams<
	T,
	G,
	TSection extends SectionedGridSectionPlan<T, G>,
	TPlan extends SectionedGridPlan<T, G, TSection>,
> {
	readonly plan: TPlan;
	readonly rowRange: RowRange;
	readonly previousBuild?: SectionedGridMountedRowsBuild<T, G, TPlan>;
	readonly reusableRowSlotsScratch?: number[];
	findSectionIndexByRow(sections: readonly TSection[], rowIndex: number): number;
	resolveRowInSection(
		plan: TPlan,
		sectionPlan: TSection,
		rowIndex: number,
	): SectionedGridResolvedRow | null;
	ensureSectionCellRangeMaterialized(
		plan: TPlan,
		sectionIndex: number,
		startCellIndex: number,
		endCellIndex: number,
	): boolean;
	readLogicalCellInSection(
		plan: TPlan,
		sectionIndex: number,
		sectionCellIndex: number,
	): VirtualListLogicalCell<T> | null;
}

type SectionedGridMountedCell<T, G> = MountedFlatCell<T, G>;

const EMPTY_PREVIOUS_CELLS: ReadonlyMap<string, never> = new Map<string, never>();

const flattenMountedRowCells = <T, G>(
	rowSlices: readonly MountedFlatRowSlice<T, G>[],
): SectionedGridMountedCell<T, G>[] => {
	const cells: SectionedGridMountedCell<T, G>[] = [];
	for (const rowSlice of rowSlices) {
		cells.push(...rowSlice.cells);
	}
	return cells;
};

export function buildSectionedGridMountedRows<
	T,
	G,
	TSection extends SectionedGridSectionPlan<T, G>,
	TPlan extends SectionedGridPlan<T, G, TSection>,
>(
	params: BuildSectionedGridMountedRowsParams<T, G, TSection, TPlan>,
): SectionedGridMountedRowsBuild<T, G, TPlan> {
	const { plan } = params;
	const start = Math.max(0, params.rowRange.start);
	const end = Math.min(plan.rowCount, params.rowRange.end);
	const rowSlices: MountedFlatRowSlice<T, G>[] = [];
	let flattenedCells: SectionedGridMountedCell<T, G>[] | undefined;
	let mountedCellCount = 0;
	let reusableCellsByKey: Map<string, SectionedGridMountedCell<T, G>> | undefined;
	const getReusableCellsByKey = (): Map<string, SectionedGridMountedCell<T, G>> => {
		if (!reusableCellsByKey) {
			reusableCellsByKey = new Map();
			for (const rowSlice of rowSlices) {
				for (const cell of rowSlice.cells) {
					reusableCellsByKey.set(cell.key, cell);
				}
			}
		}
		return reusableCellsByKey;
	};
	const getPreviousCellsByKey = (): ReadonlyMap<
		string,
		SectionedGridMountedCell<T, G>
	> => params.previousBuild?.reusableCellsByKey ?? EMPTY_PREVIOUS_CELLS;
	const canReusePreviousCellsByKey =
		params.previousBuild !== undefined &&
		(params.previousBuild.plan !== plan ||
			params.previousBuild.materializationRevision !==
				plan.materializationRevision);
	const previousRows = params.previousBuild?.rowSlices;
	const previousRowStart = params.previousBuild?.rowRange.start ?? 0;
	const previousRowEnd = params.previousBuild?.rowRange.end ?? 0;
	const getPreviousRow = (
		rowIndex: number,
	): MountedFlatRowSlice<T, G> | undefined => {
		if (!previousRows) return undefined;
		if (rowIndex < previousRowStart || rowIndex >= previousRowEnd) {
			return undefined;
		}
		const previousRow = previousRows[rowIndex - previousRowStart];
		return previousRow?.rowIndex === rowIndex ? previousRow : undefined;
	};
	const reusableRowSlots = params.reusableRowSlotsScratch ?? [];
	reusableRowSlots.length = 0;
	let nextRowSlotIndex = 0;
	for (const previousRow of previousRows ?? []) {
		const slotIndex = previousRow.slotIndex ?? 0;
		nextRowSlotIndex = Math.max(nextRowSlotIndex, slotIndex + 1);
		if (previousRow.rowIndex < start || previousRow.rowIndex >= end) {
			reusableRowSlots.push(slotIndex);
		}
	}
	let reusableRowSlotOffset = 0;
	const allocateRowSlotIndex = (): number => {
		const reusableSlot = reusableRowSlots[reusableRowSlotOffset];
		if (reusableSlot !== undefined) {
			reusableRowSlotOffset += 1;
			return reusableSlot;
		}
		const slotIndex = nextRowSlotIndex;
		nextRowSlotIndex += 1;
		return slotIndex;
	};
	let sectionIndex = params.findSectionIndexByRow(plan.sections, start);
	let lastSectionIndex = -1;
	let sectionLayout: SectionLayout<T, G> | null = null;

	for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
		while (
			sectionIndex >= 0 &&
			rowIndex >=
				(plan.sections[sectionIndex]?.firstRowIndex ?? 0) +
					(plan.sections[sectionIndex]?.rowCount ?? 0)
		) {
			sectionIndex += 1;
		}
		const sectionPlan = plan.sections[sectionIndex];
		if (!sectionPlan) break;
		const resolvedRow = params.resolveRowInSection(plan, sectionPlan, rowIndex);
		if (!resolvedRow) continue;
		const {
			rowIndexInSection,
			sectionCellStartIndex: firstSectionCellIndex,
			cellCount: rowCellCount,
			top: rowTop,
		} = resolvedRow;
		const rowKey = rowIndex;
		const previousRow = getPreviousRow(rowIndex);
		if (
			params.previousBuild?.plan === plan &&
			params.previousBuild.materializationRevision ===
				plan.materializationRevision &&
			previousRow
		) {
			rowSlices.push(previousRow);
			mountedCellCount += previousRow.cells.length;
			continue;
		}
		params.ensureSectionCellRangeMaterialized(
			plan,
			sectionIndex,
			firstSectionCellIndex,
			firstSectionCellIndex + rowCellCount,
		);
		if (sectionIndex !== lastSectionIndex) {
			lastSectionIndex = sectionIndex;
			sectionLayout = sectionPlan.mountedLayout;
		}
		const row: FlatRow<T, G> = {
			sectionIndex,
			key: rowKey,
			rowIndexInSection,
			cellStartIndex: firstSectionCellIndex,
			rowCellCount,
			top: rowTop,
			bottomSpacing: plan.rowGap,
		};
		const slotIndex = previousRow?.slotIndex ?? allocateRowSlotIndex();
		const rowSlice: MountedFlatRowSlice<T, G> = {
			slotIndex,
			slotKey: slotIndex,
			rowIndex,
			rowKey,
			key: rowKey,
			top: rowTop,
			cells: [],
		};
		if (!sectionLayout) {
			rowSlices.push(rowSlice);
			continue;
		}
		for (let columnIndex = 0; columnIndex < rowCellCount; columnIndex += 1) {
			const cell = params.readLogicalCellInSection(
				plan,
				sectionIndex,
				firstSectionCellIndex + columnIndex,
			);
			if (!cell) continue;
			const previous = canReusePreviousCellsByKey
				? getPreviousCellsByKey().get(cell.key)
				: undefined;
			const renderSlotIndex = slotIndex * plan.columns + columnIndex;
			const cellSlotKey = renderSlotIndex;
			const mountedCell =
				previous &&
				canReuseMountedFlatCellContent(previous, cell, sectionLayout)
					? updateMountedFlatCell({
							previous,
							cell,
							rowIndex,
							columnIndex,
							row,
							section: sectionLayout,
							renderSlotIndex,
							cellSlotKey,
						})
					: createMountedFlatCell({
							key: cell.key,
							cell,
							row,
							section: sectionLayout,
							rowIndex,
							columnIndex,
							renderSlotIndex,
							renderBodyKey: resolveStableViewPlanRenderBodyKey({
								previous,
								cell,
								descriptor: sectionLayout.descriptor,
							}),
							renderBodyIdentity: getViewPlanRenderBodyIdentityFields(
								cell,
								sectionLayout.descriptor,
							),
							cellSlotKey,
						});
			rowSlice.cells.push(mountedCell);
			mountedCellCount += 1;
		}
		rowSlices.push(rowSlice);
	}

	return {
		get cells() {
			flattenedCells ??= flattenMountedRowCells(rowSlices);
			return flattenedCells;
		},
		rowSlices,
		get reusableCellsByKey() {
			return getReusableCellsByKey();
		},
		mountedCellCount,
		nextRenderSlotIndex: nextRowSlotIndex * plan.columns,
		rowRange: { start, end },
		plan,
		materializationRevision: plan.materializationRevision,
	};
}
