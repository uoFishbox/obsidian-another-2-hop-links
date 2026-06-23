import { createScheduledVirtualListTask } from "ui/components/common/virtual-list/dom/virtualListScheduler";
import {
	EMPTY_ROW_RANGE,
	type RowRange,
} from "ui/components/common/virtual-list/rowRange";
import type { VirtualRanges } from "ui/components/common/virtual-list/types";
import {
	createVirtualizedItemVisibilityStateController,
	type VirtualizedItemResolvedVisibilityState,
} from "ui/components/common/virtual-list/svelte/virtualizedItemVisibilityState.svelte";
import type { MountedFlatCell } from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";
import {
	buildTwoHopMountedRows,
	type TwoHopMountedRowsBuild,
} from "./twoHopMountedRowBuild";
import type {
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection,
} from "./twohopPageVirtualModel";
import type { TwoHopViewPlanRowModel } from "./twoHopViewPlan";

const EMPTY_MOUNTED_ROWS: readonly [] = [];

type TwoHopMountedCell = MountedFlatCell<
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection
>;

export function createTwoHopMountRuntime() {
	const visibilityStates =
		createVirtualizedItemVisibilityStateController<TwoHopMountedCell>();
	let visibilityMountedRows: TwoHopMountedRowsBuild["rowSlices"] | readonly [] =
		EMPTY_MOUNTED_ROWS;
	let visibilityMountedRowRange: RowRange = EMPTY_ROW_RANGE;
	let visibilityMountedPlan: TwoHopMountedRowsBuild["plan"] | null = null;
	const visibilityPreviewRange: RowRange = { start: 0, end: 0 };
	let hasVisibilityPreviewRange = false;
	let pendingBuild: TwoHopMountedRowsBuild | null = null;
	const pendingPreviewRange: RowRange = { start: 0, end: 0 };
	let hasPendingPreviewRange = false;
	const reusableRowSlotsScratch: number[] = [];

	const syncVisibilityStates = (
		mountedBuild: TwoHopMountedRowsBuild | null | undefined,
		nextPreviewRange: RowRange,
	): void => {
		const mountedRows = mountedBuild?.rowSlices ?? EMPTY_MOUNTED_ROWS;
		const mountedRowRange = mountedBuild?.rowRange ?? EMPTY_ROW_RANGE;
		const mountedPlan = mountedBuild?.plan ?? null;
		if (!hasVisibilityPreviewRange || mountedPlan !== visibilityMountedPlan) {
			visibilityStates.syncMountedRows({
				mountedRows,
				previewRange: nextPreviewRange,
			});
		} else if (mountedRows !== visibilityMountedRows) {
			visibilityStates.syncMountedRowRangeDelta({
				previousRows: visibilityMountedRows,
				nextRows: mountedRows,
				previousRowRange: visibilityMountedRowRange,
				nextRowRange: mountedRowRange,
				previewRange: nextPreviewRange,
			});
		} else {
			visibilityStates.syncPreviewRangeDelta({
				previousPreviewRange: visibilityPreviewRange,
				nextPreviewRange,
				mountedRows,
			});
		}

		visibilityMountedRows = mountedRows;
		visibilityMountedRowRange = mountedRowRange;
		visibilityMountedPlan = mountedPlan;
		visibilityPreviewRange.start = nextPreviewRange.start;
		visibilityPreviewRange.end = nextPreviewRange.end;
		hasVisibilityPreviewRange = true;
	};

	const previewVisibleSyncTask = createScheduledVirtualListTask(() => {
		const build = pendingBuild;
		pendingBuild = null;
		if (!hasPendingPreviewRange) return;
		hasPendingPreviewRange = false;
		syncVisibilityStates(build, pendingPreviewRange);
	});

	return {
		buildMountedRows(params: {
			rowModel: TwoHopViewPlanRowModel;
			rowRange: RowRange;
			ranges: VirtualRanges;
			previousBuild?: TwoHopMountedRowsBuild;
		}): TwoHopMountedRowsBuild {
			return buildTwoHopMountedRows({
				rowModel: params.rowModel,
				rowRange: params.rowRange,
				ranges: params.ranges,
				previousBuild: params.previousBuild,
				reusableRowSlotsScratch,
			});
		},
		syncSnapshot(
			mountedBuild: TwoHopMountedRowsBuild | null | undefined,
			previewRange: RowRange,
		): void {
			syncVisibilityStates(mountedBuild, previewRange);
		},
		schedulePreviewRangeSync(
			mountedBuild: TwoHopMountedRowsBuild | null | undefined,
			start: number,
			end: number,
		): void {
			pendingBuild = mountedBuild ?? null;
			pendingPreviewRange.start = start;
			pendingPreviewRange.end = end;
			hasPendingPreviewRange = true;
			previewVisibleSyncTask.schedule();
		},
		cancelScheduledSync(): void {
			pendingBuild = null;
			hasPendingPreviewRange = false;
			previewVisibleSyncTask.cancel();
		},
		getOrCreateVisibilityState(
			cell: TwoHopMountedCell,
			initialVisibility: VirtualizedItemVisibility,
		): VirtualizedItemResolvedVisibilityState {
			return visibilityStates.getOrCreateState(cell, initialVisibility);
		},
	};
}
