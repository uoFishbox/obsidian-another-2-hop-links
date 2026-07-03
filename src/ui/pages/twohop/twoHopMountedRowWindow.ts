import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { VirtualRanges } from "ui/components/common/virtual-list/types";
import {
	EMPTY_ROW_SLOT_CHANGE_SET,
	type SectionedGridResolvedRowScratch,
} from "ui/components/common/virtual-list/row-models/sectionedGridMountedRows";
import {
	buildTwoHopMountedRows,
	type TwoHopMountedRowsBuild,
} from "./twoHopMountedRowBuild";
import type { TwoHopViewPlanRowModel } from "./twoHopViewPlan";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { IS_PROD } from "appConstants";

export interface TwoHopMountedRowWindowApplyParams {
	readonly rowModel: TwoHopViewPlanRowModel;
	readonly rowRange: RowRange;
	readonly ranges: VirtualRanges;
	readonly previousBuild?: TwoHopMountedRowsBuild;
}

export interface TwoHopMountedRowWindow {
	/**
	 * Apply a new set of parameters and determine whether Svelte should be
	 * notified.
	 *
	 * Returns the current mounted build. Check `lastApplyChanged` immediately
	 * after calling to determine whether mounted row slots should be synced.
	 */
	apply(params: TwoHopMountedRowWindowApplyParams): TwoHopMountedRowsBuild;

	/** Whether the most recent `apply` changed the mounted build. */
	readonly lastApplyChanged: boolean;

	/** Slot-level changes produced by the most recent changed `apply`. */
	readonly lastRowSlotChanges: TwoHopMountedRowsBuild["rowSlotChanges"];

	/** The current build, or undefined if no apply has been called yet. */
	readonly build: TwoHopMountedRowsBuild | undefined;

	/** Reset to initial state. */
	reset(): void;
}

interface TwoHopMountedRowWindowState {
	build: TwoHopMountedRowsBuild | undefined;
	plan: TwoHopMountedRowsBuild["plan"] | undefined;
	rowRange: RowRange;
	cellStoreRevision: number;
	lastApplyChanged: boolean;
	lastRowSlotChanges: TwoHopMountedRowsBuild["rowSlotChanges"];
}

const INITIAL_ROW_RANGE: RowRange = { start: -1, end: -1 };

function resolveClampedRangeStart(range: RowRange): number {
	return Math.max(0, range.start);
}

function resolveClampedRangeEnd(range: RowRange, rowCount: number): number {
	return Math.min(rowCount, range.end);
}

function setClampedRange(out: RowRange, range: RowRange, rowCount: number): void {
	out.start = resolveClampedRangeStart(range);
	out.end = resolveClampedRangeEnd(range, rowCount);
}

/**
 * TwoHop-specific mounted row window runtime.
 *
 * This is a non-reactive guard in front of `buildTwoHopMountedRows`. Its
 * primary purpose is to skip the builder entirely when nothing has changed
 * (same plan, same clamped range, same relevant materialization revisions).
 *
 * Row/cell slot reuse is delegated to the existing
 * `buildSectionedGridMountedRows` builder, which already handles slot
 * recycling via `reusableRowSlotsScratch`.
 */
export function createTwoHopMountedRowWindow(): TwoHopMountedRowWindow {
	const reusableRowSlotsScratch: number[] = [];
	const assignedRowSlotMarksScratch: number[] = [];
	const resolvedRowScratch: SectionedGridResolvedRowScratch = {
		rowIndexInSection: 0,
		sectionCellStartIndex: 0,
		cellCount: 0,
		top: 0,
	};
	const state: TwoHopMountedRowWindowState = {
		build: undefined,
		plan: undefined,
		rowRange: { ...INITIAL_ROW_RANGE },
		cellStoreRevision: -1,
		lastApplyChanged: false,
		lastRowSlotChanges: EMPTY_ROW_SLOT_CHANGE_SET,
	};

	function haveMountedRowRevisionsChanged(build: TwoHopMountedRowsBuild): boolean {
		const rowRevisions = build.plan.cellStore.rowRevisionByRowIndex;
		for (const row of build.rowSlices) {
			if (
				(row.materializationRevision ?? 0) !== (rowRevisions[row.rowIndex] ?? 0)
			) {
				return true;
			}
		}
		return false;
	}

	function apply(params: TwoHopMountedRowWindowApplyParams): TwoHopMountedRowsBuild {
		if (!IS_PROD) {
			recordCCLDevMeasurement("twoHop.rowWindow.apply");
		}

		const { rowModel, rowRange, ranges, previousBuild } = params;
		const plan = rowModel.plan;
		const cellStoreRevisionBeforeBuild = plan.cellStore.revision;
		const clampedStart = resolveClampedRangeStart(rowRange);
		const clampedEnd = resolveClampedRangeEnd(rowRange, plan.rowCount);
		const currentBuild = state.build;
		const isFirstBuild = currentBuild === undefined;
		const hasPlanChanged = !isFirstBuild && state.plan !== plan;
		const hasRowRangeChanged =
			!isFirstBuild &&
			(state.rowRange.start !== clampedStart ||
				state.rowRange.end !== clampedEnd);
		const hasCellStoreRevisionChanged =
			!isFirstBuild && state.cellStoreRevision !== cellStoreRevisionBeforeBuild;

		// Fast path: nothing changed — skip the builder entirely.
		if (
			!isFirstBuild &&
			!hasPlanChanged &&
			!hasRowRangeChanged &&
			!hasCellStoreRevisionChanged
		) {
			state.lastApplyChanged = false;
			state.lastRowSlotChanges = EMPTY_ROW_SLOT_CHANGE_SET;
			if (!IS_PROD) {
				recordCCLDevMeasurement("twoHop.rowWindow.apply.skipped");
			}
			return currentBuild;
		}

		if (
			!isFirstBuild &&
			!hasPlanChanged &&
			!hasRowRangeChanged &&
			hasCellStoreRevisionChanged &&
			!haveMountedRowRevisionsChanged(currentBuild)
		) {
			state.cellStoreRevision = cellStoreRevisionBeforeBuild;
			state.lastApplyChanged = false;
			state.lastRowSlotChanges = EMPTY_ROW_SLOT_CHANGE_SET;
			if (!IS_PROD) {
				recordCCLDevMeasurement("twoHop.rowWindow.apply.skipped");
			}
			return currentBuild;
		}

		// Something changed — delegate to the builder.
		const build = buildTwoHopMountedRows({
			rowModel,
			rowRange,
			ranges,
			previousBuild: previousBuild ?? state.build,
			reusableRowSlotsScratch,
			assignedRowSlotMarksScratch,
			resolvedRowScratch,
		});

		state.build = build;
		state.plan = plan;
		setClampedRange(state.rowRange, build.rowRange, plan.rowCount);
		state.cellStoreRevision = plan.cellStore.revision;
		state.lastApplyChanged = true;
		state.lastRowSlotChanges = build.rowSlotChanges;
		if (!IS_PROD) {
			recordCCLDevMeasurement("twoHop.rowWindow.apply.changed");
			if (isFirstBuild) {
				recordCCLDevMeasurement("twoHop.rowWindow.apply.changed.firstBuild");
			}
			if (hasPlanChanged) {
				recordCCLDevMeasurement("twoHop.rowWindow.apply.changed.plan");
			}
			if (hasRowRangeChanged) {
				recordCCLDevMeasurement("twoHop.rowWindow.apply.changed.rowRange");
			}
			if (hasCellStoreRevisionChanged) {
				recordCCLDevMeasurement(
					"twoHop.rowWindow.apply.changed.cellStoreRevision",
				);
			}
		}

		return build;
	}

	function reset(): void {
		state.build = undefined;
		state.plan = undefined;
		state.rowRange.start = INITIAL_ROW_RANGE.start;
		state.rowRange.end = INITIAL_ROW_RANGE.end;
		state.cellStoreRevision = -1;
		state.lastApplyChanged = false;
		state.lastRowSlotChanges = EMPTY_ROW_SLOT_CHANGE_SET;
	}

	return {
		apply,
		reset,
		get build() {
			return state.build;
		},
		get lastApplyChanged() {
			return state.lastApplyChanged;
		},
		get lastRowSlotChanges() {
			return state.lastRowSlotChanges;
		},
	};
}
