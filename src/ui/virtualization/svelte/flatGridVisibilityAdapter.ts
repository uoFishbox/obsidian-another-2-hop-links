import type { RowRange } from "../rowRange";
import type {
	MountedVirtualGridCell,
	MountedVirtualGridRowSlice,
} from "../core/reconciliation/linkListVirtualLayout";
import {
	createVirtualizedItemVisibilityStateController,
	type VirtualizedItemVisibilityStateControllerOptions,
} from "./virtualizedItemVisibilityState.svelte";

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
	const syncVisibilityStates = (params: {
		mountedRows: readonly MountedVirtualGridRowSlice<T>[] | readonly [];
		mountedRange: RowRange;
		previewRange: RowRange;
		rowModel: object;
	}): void => {
		visibilityStates.commit({
			rowModelRevision: params.rowModel,
			mountedRows: params.mountedRows,
			mountedRange: params.mountedRange,
			previewActiveRange: params.previewRange,
		});
	};

	return {
		visibilityStates,
		getMountedRows(): readonly MountedVirtualGridRowSlice<T>[] | readonly [] {
			return visibilityStates.getCommittedMountedRows() as readonly MountedVirtualGridRowSlice<T>[];
		},
		getMountedRange() {
			return visibilityStates.getCommittedMountedRange();
		},
		getActiveRowModel() {
			const revision = visibilityStates.getCommittedRowModelRevision();
			return typeof revision === "object" ? revision : null;
		},
		syncVisibilityStates,
	};
}
