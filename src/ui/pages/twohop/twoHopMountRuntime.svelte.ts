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
import type { MountedFlatCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";
import {
	buildTwoHopMountedRows,
	type TwoHopMountedRowsBuild,
} from "./twoHopMountedRowBuild";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import type { TwoHopViewPlanRowModel } from "./twoHopViewPlan";
import type { RowPreviewActivationRuntime } from "features/preview/scheduling/rowPreviewActivationRuntime";
import { resolveTwoHopSlotId } from "./twoHopSlotId";
import { createPooledRowSlotAllocator } from "ui/components/common/virtual-list/core/reconciliation/pooledRowSlotAllocator";
import type { SectionedGridResolvedRowScratch } from "ui/components/common/virtual-list/row-models/sectionedGridMountedRows";

const EMPTY_MOUNTED_ROWS: readonly [] = [];

type TwoHopMountedCell = MountedFlatCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

interface TwoHopVisibilitySyncBuild {
	readonly rowSlices: TwoHopMountedRowsBuild["rowSlices"] | readonly [];
	readonly rowRange: RowRange;
	readonly plan: TwoHopMountedRowsBuild["plan"] | null;
}

// Visibility state is intentionally keyed by render slot, not logical item.
// The virtual surface reuses slot components while scrolling, so slot-keyed
// state avoids per-item state churn at the mounted range edges. Logical preview
// correctness is guarded separately by previewIdentity / activationKey in
// CardPreviewGate and by logical-item renderBodyKey revisions.
function getTwoHopVisibilityStateKey(cell: TwoHopMountedCell): string {
	return resolveTwoHopSlotId(cell);
}

export function createTwoHopMountRuntime(
	params: {
		rowPreviewActivationRuntime?: RowPreviewActivationRuntime;
	} = {},
) {
	const visibilityStates =
		createVirtualizedItemVisibilityStateController<TwoHopMountedCell>({
			getStateKey: getTwoHopVisibilityStateKey,
			onRowVisibilityChanged: (rowIndex, visibility) => {
				params.rowPreviewActivationRuntime?.setRowVisibility(
					rowIndex,
					visibility,
				);
			},
			onRowCleared: (rowIndex) => {
				params.rowPreviewActivationRuntime?.clearRow(rowIndex);
			},
		});
	let visibilityMountedRows: TwoHopMountedRowsBuild["rowSlices"] | readonly [] =
		EMPTY_MOUNTED_ROWS;
	let visibilityMountedRowRange: RowRange = EMPTY_ROW_RANGE;
	let visibilityMountedPlan: TwoHopMountedRowsBuild["plan"] | null = null;
	const visibilityPreviewRange: RowRange = { start: 0, end: 0 };
	let hasVisibilityPreviewRange = false;
	let pendingBuild: TwoHopMountedRowsBuild | null = null;
	const pendingPreviewRange: RowRange = { start: 0, end: 0 };
	let hasPendingPreviewRange = false;
	const rowSlotAllocator = createPooledRowSlotAllocator();
	const resolvedRowScratch: SectionedGridResolvedRowScratch = {
		rowIndexInSection: 0,
		sectionCellStartIndex: 0,
		cellCount: 0,
		top: 0,
	};
	const mountedRowsSyncParams: Parameters<
		typeof visibilityStates.syncMountedRows
	>[0] = {
		mountedRows: EMPTY_MOUNTED_ROWS,
		previewRange: EMPTY_ROW_RANGE,
	};
	const mountedRowRangeDeltaSyncParams: Parameters<
		typeof visibilityStates.syncMountedRowRangeDelta
	>[0] = {
		previousRows: EMPTY_MOUNTED_ROWS,
		nextRows: EMPTY_MOUNTED_ROWS,
		previousRowRange: EMPTY_ROW_RANGE,
		nextRowRange: EMPTY_ROW_RANGE,
		previewRange: EMPTY_ROW_RANGE,
	};
	const previewRangeDeltaSyncParams: Parameters<
		typeof visibilityStates.syncPreviewRangeDelta
	>[0] = {
		previousPreviewRange: EMPTY_ROW_RANGE,
		nextPreviewRange: EMPTY_ROW_RANGE,
		mountedRows: EMPTY_MOUNTED_ROWS,
	};
	const visibilitySyncBuildScratch: {
		rowSlices: TwoHopMountedRowsBuild["rowSlices"] | readonly [];
		rowRange: RowRange;
		plan: TwoHopMountedRowsBuild["plan"] | null;
	} = {
		rowSlices: EMPTY_MOUNTED_ROWS,
		rowRange: EMPTY_ROW_RANGE,
		plan: null,
	};

	const syncVisibilityStates = (
		mountedBuild: TwoHopVisibilitySyncBuild | null | undefined,
		nextPreviewRange: RowRange,
	): void => {
		const mountedRows = mountedBuild?.rowSlices ?? EMPTY_MOUNTED_ROWS;
		const mountedRowRange = mountedBuild?.rowRange ?? EMPTY_ROW_RANGE;
		const mountedPlan = mountedBuild?.plan ?? null;
		const mountedRangeChanged =
			mountedRowRange.start !== visibilityMountedRowRange.start ||
			mountedRowRange.end !== visibilityMountedRowRange.end;
		if (!hasVisibilityPreviewRange || mountedPlan !== visibilityMountedPlan) {
			mountedRowsSyncParams.mountedRows = mountedRows;
			mountedRowsSyncParams.previewRange = nextPreviewRange;
			visibilityStates.syncMountedRows(mountedRowsSyncParams);
		} else if (mountedRangeChanged) {
			mountedRowRangeDeltaSyncParams.previousRows = visibilityMountedRows;
			mountedRowRangeDeltaSyncParams.nextRows = mountedRows;
			mountedRowRangeDeltaSyncParams.previousRowRange = visibilityMountedRowRange;
			mountedRowRangeDeltaSyncParams.nextRowRange = mountedRowRange;
			mountedRowRangeDeltaSyncParams.previewRange = nextPreviewRange;
			visibilityStates.syncMountedRowRangeDelta(mountedRowRangeDeltaSyncParams);
		} else {
			previewRangeDeltaSyncParams.previousPreviewRange = visibilityPreviewRange;
			previewRangeDeltaSyncParams.nextPreviewRange = nextPreviewRange;
			previewRangeDeltaSyncParams.mountedRows = mountedRows;
			visibilityStates.syncPreviewRangeDelta(previewRangeDeltaSyncParams);
		}

		visibilityMountedRows = mountedRows;
		visibilityMountedRowRange = mountedRowRange;
		visibilityMountedPlan = mountedPlan;
		visibilityPreviewRange.start = nextPreviewRange.start;
		visibilityPreviewRange.end = nextPreviewRange.end;
		hasVisibilityPreviewRange = true;
	};

	const previewVisibleSyncTask = createScheduledVirtualListTask(() => {
		let build: TwoHopVisibilitySyncBuild;
		if (pendingBuild) {
			build = pendingBuild;
		} else {
			visibilitySyncBuildScratch.rowSlices = visibilityMountedRows;
			visibilitySyncBuildScratch.rowRange = visibilityMountedRowRange;
			visibilitySyncBuildScratch.plan = visibilityMountedPlan;
			build = visibilitySyncBuildScratch;
		}
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
				...params,
				rowSlotAllocator,
				resolvedRowScratch,
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
		rowSlotAllocator,
		getOrCreateVisibilityState(
			cell: TwoHopMountedCell,
			initialVisibility: VirtualizedItemVisibility,
		): VirtualizedItemResolvedVisibilityState {
			return visibilityStates.getOrCreateState(cell, initialVisibility);
		},
	};
}
