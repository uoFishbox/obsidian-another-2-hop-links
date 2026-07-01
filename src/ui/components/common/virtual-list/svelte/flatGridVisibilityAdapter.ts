import type { RowRange } from "../rowRange";
import type {
	MountedVirtualGridCell,
	MountedVirtualGridRowSlice,
} from "../core/reconciliation/linkListVirtualLayout";
import {
	createVirtualizedItemVisibilityStateController,
	type VirtualizedItemVisibilityStateControllerOptions,
} from "./virtualizedItemVisibilityState.svelte";

const EMPTY_MOUNTED_ROWS: readonly MountedVirtualGridRowSlice<never>[] = [];

export interface FlatGridVisibilityAdapterOptions<
	T,
> extends VirtualizedItemVisibilityStateControllerOptions<MountedVirtualGridCell<T>> {}

export function createFlatGridVisibilityAdapter<T>(
	options: FlatGridVisibilityAdapterOptions<T> = {},
) {
	const visibilityStates =
		createVirtualizedItemVisibilityStateController<MountedVirtualGridCell<T>>(
			options,
		);
	let visibilityMountedRows: readonly MountedVirtualGridRowSlice<T>[] | readonly [] =
		EMPTY_MOUNTED_ROWS;
	const visibilityMountedRange: RowRange = { start: 0, end: 0 };
	let visibilityRowModel: object | null = null;
	const visibilityPreviewRange: RowRange = { start: 0, end: 0 };
	let hasVisibilityPreviewRange = false;

	const syncVisibilityStates = (params: {
		mountedRows: readonly MountedVirtualGridRowSlice<T>[] | readonly [];
		mountedRange: RowRange;
		previewRange: RowRange;
		rowModel: object;
	}): void => {
		const {
			mountedRows,
			mountedRange: nextMountedRange,
			previewRange: nextPreviewRange,
			rowModel: nextRowModel,
		} = params;
		if (!hasVisibilityPreviewRange || nextRowModel !== visibilityRowModel) {
			visibilityStates.syncMountedRows({
				mountedRows,
				previewRange: nextPreviewRange,
			});
		} else if (mountedRows !== visibilityMountedRows) {
			visibilityStates.syncMountedRowRangeDelta({
				previousRows: visibilityMountedRows,
				nextRows: mountedRows,
				previousRowRange: visibilityMountedRange,
				nextRowRange: nextMountedRange,
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
		visibilityMountedRange.start = nextMountedRange.start;
		visibilityMountedRange.end = nextMountedRange.end;
		visibilityRowModel = nextRowModel;
		visibilityPreviewRange.start = nextPreviewRange.start;
		visibilityPreviewRange.end = nextPreviewRange.end;
		hasVisibilityPreviewRange = true;
	};

	return {
		visibilityStates,
		getMountedRows() {
			return visibilityMountedRows;
		},
		getMountedRange() {
			return visibilityMountedRange;
		},
		getActiveRowModel() {
			return visibilityRowModel;
		},
		syncVisibilityStates,
	};
}
