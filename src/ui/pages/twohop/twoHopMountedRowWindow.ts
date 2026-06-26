import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { VirtualRanges } from "ui/components/common/virtual-list/types";
import {
	buildTwoHopMountedRows,
	type TwoHopMountedRowsBuild,
} from "./twoHopMountedRowBuild";
import type { TwoHopViewPlanRowModel } from "./twoHopViewPlan";

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
	 * after calling to determine whether the caller should bump
	 * `mountedRowsVersion`.
	 */
	apply(params: TwoHopMountedRowWindowApplyParams): TwoHopMountedRowsBuild;

	/** Whether the most recent `apply` changed the mounted build. */
	readonly lastApplyChanged: boolean;

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
 * (same plan, same clamped range, same cellStore.revision).
 *
 * Row/cell slot reuse is delegated to the existing
 * `buildSectionedGridMountedRows` builder, which already handles slot
 * recycling via `reusableRowSlotsScratch`.
 */
export function createTwoHopMountedRowWindow(): TwoHopMountedRowWindow {
	const state: TwoHopMountedRowWindowState = {
		build: undefined,
		plan: undefined,
		rowRange: { ...INITIAL_ROW_RANGE },
		cellStoreRevision: -1,
		lastApplyChanged: false,
	};

	function apply(params: TwoHopMountedRowWindowApplyParams): TwoHopMountedRowsBuild {
		const { rowModel, rowRange, ranges, previousBuild } = params;
		const plan = rowModel.plan;
		const cellStoreRevision = plan.cellStore.revision;
		const clampedStart = resolveClampedRangeStart(rowRange);
		const clampedEnd = resolveClampedRangeEnd(rowRange, plan.rowCount);

		// Fast path: nothing changed — skip the builder entirely.
		if (
			state.build !== undefined &&
			state.plan === plan &&
			state.rowRange.start === clampedStart &&
			state.rowRange.end === clampedEnd &&
			state.cellStoreRevision === cellStoreRevision
		) {
			state.lastApplyChanged = false;
			return state.build;
		}

		// Something changed — delegate to the builder.
		const build = buildTwoHopMountedRows({
			rowModel,
			rowRange,
			ranges,
			previousBuild: previousBuild ?? state.build,
		});

		state.build = build;
		state.plan = plan;
		setClampedRange(state.rowRange, build.rowRange, plan.rowCount);
		state.cellStoreRevision = cellStoreRevision;
		state.lastApplyChanged = true;

		return build;
	}

	function reset(): void {
		state.build = undefined;
		state.plan = undefined;
		state.rowRange.start = INITIAL_ROW_RANGE.start;
		state.rowRange.end = INITIAL_ROW_RANGE.end;
		state.cellStoreRevision = -1;
		state.lastApplyChanged = false;
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
	};
}
