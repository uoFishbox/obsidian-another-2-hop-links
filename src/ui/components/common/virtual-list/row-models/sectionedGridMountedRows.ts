import type { RowRange } from "../rowRange";
import type { VirtualListLogicalCell } from "../logicalCell";
import type { FlatRow, SectionLayout } from "../layout/viewPlanRowTypes";
import {
	canReuseMountedFlatCellContent,
	createMountedFlatCell,
	updateMountedFlatCell,
	type MountedFlatCell,
} from "../core/reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "../core/reconciliation/viewPlanRenderRows";
import {
	getViewPlanRenderBodyIdentityFields,
	resolveStableViewPlanRenderBodyKey,
} from "../core/reconciliation/renderBodyRevision";

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
}

export interface SectionedGridResolvedRow {
	readonly rowIndexInSection: number;
	readonly sectionCellStartIndex: number;
	readonly cellCount: number;
	readonly top: number;
}

/**
 * Mutable scratch object for {@link resolveRowInSectionInto} callbacks.
 * Callers must read scalar values immediately after the callback returns
 * because the same object is reused across iterations.
 */
export interface SectionedGridResolvedRowScratch {
	rowIndexInSection: number;
	sectionCellStartIndex: number;
	cellCount: number;
	top: number;
}

export interface SectionedGridMountedRowsBuild<T, G, TPlan> {
	readonly cells: MountedFlatCell<T, G>[];
	readonly rowSlices: MountedFlatRowSlice<T, G>[];
	readonly reusableCellsByKey: Map<string, MountedFlatCell<T, G>>;
	readonly mountedCellCount: number;
	readonly nextRenderSlotIndex: number;
	readonly rowRange: RowRange;
	readonly plan: TPlan;
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
	readonly resolvedRowScratch?: SectionedGridResolvedRowScratch;
	findSectionIndexByRow(sections: readonly TSection[], rowIndex: number): number;
	resolveRowInSection(
		plan: TPlan,
		sectionPlan: TSection,
		rowIndex: number,
	): SectionedGridResolvedRow | null;
	/**
	 * Optional Into-style resolver that writes into a reusable scratch object
	 * instead of allocating a new object per call. When provided, the builder
	 * prefers this over {@link resolveRowInSection}.
	 */
	resolveRowInSectionInto?(
		out: SectionedGridResolvedRowScratch,
		plan: TPlan,
		sectionPlan: TSection,
		rowIndex: number,
	): boolean;
	readLogicalCellInSection(
		plan: TPlan,
		sectionIndex: number,
		sectionCellIndex: number,
	): VirtualListLogicalCell<T> | null;
}

/**
 * The builder is a pure "row range → mounted rows" transform: it reads every
 * cell through {@link readLogicalCellInSection}. Callers must ensure the cells
 * for {@link BuildSectionedGridMountedRowsParams.rowRange} are materialized
 * before invoking the builder (e.g. via an equivalent of
 * `ensureMountedRangeMaterialized(rowRange)` on the cell store). Carrying the
 * materialization side effect inside the builder would blur its single
 * responsibility of converting a mounted row range into mounted rows.
 */

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
	// Same-plan, same-clamped-range fast path: when the plan object and the
	// clamped mounted range are identical to the previous build, the per-row
	// reuse branch below would push every previous row slice verbatim, so the
	// resulting rowSlices array would carry identical element references and
	// identical derived fields (mountedCellCount, nextRenderSlotIndex, lazy
	// cells / reusableCellsByKey). Return the previous build directly to
	// preserve rowSlices array identity, which lets the engine skip
	// applyVirtualCellMetadata / indexMountedCells and lets Svelte #each
	// blocks skip re-rendering keyed rows. Logical cells are mutated in place
	// within a single plan object, so reused mounted cells already observe the
	// latest cell state and no rebuild is required.
	const previousBuild = params.previousBuild;
	if (
		previousBuild !== undefined &&
		previousBuild.plan === plan &&
		previousBuild.rowRange.start === start &&
		previousBuild.rowRange.end === end
	) {
		if (params.reusableRowSlotsScratch) {
			params.reusableRowSlotsScratch.length = 0;
		}
		return previousBuild;
	}
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
	// Cell-level reuse across the previous build is only useful when the plan
	// object changes (same data re-compiled). Within a single plan object,
	// materialization mutates logical cells in place, so reused rows carry
	// stable cell references via the slice-reuse fast path below, and rows
	// newly entering the range never had cells in the previous build.
	const canReusePreviousCellsByKey =
		params.previousBuild !== undefined && params.previousBuild.plan !== plan;
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

	const localResolvedScratch: SectionedGridResolvedRowScratch = {
		rowIndexInSection: 0,
		sectionCellStartIndex: 0,
		cellCount: 0,
		top: 0,
	};
	// Scalar values are read immediately per iteration, so caller-provided
	// scratch reuse is safe.
	const resolvedScratch = params.resolvedRowScratch ?? localResolvedScratch;
	const useInto = params.resolveRowInSectionInto !== undefined;

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
		const resolvedRow = useInto
			? params.resolveRowInSectionInto!(
					resolvedScratch,
					plan,
					sectionPlan,
					rowIndex,
				)
				? resolvedScratch
				: null
			: params.resolveRowInSection(plan, sectionPlan, rowIndex);
		if (!resolvedRow) continue;
		const {
			rowIndexInSection,
			sectionCellStartIndex: firstSectionCellIndex,
			cellCount: rowCellCount,
			top: rowTop,
		} = resolvedRow;
		const rowKey = rowIndex;
		const previousRow = getPreviousRow(rowIndex);
		if (params.previousBuild?.plan === plan && previousRow) {
			rowSlices.push(previousRow);
			mountedCellCount += previousRow.cells.length;
			continue;
		}
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
	};
}
