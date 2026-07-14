import { getContext, untrack } from "svelte";
import type { MountedFlatItemCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import type { TwoHopVirtualListInputRuntime } from "./twoHopVirtualListInputRuntime.svelte";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";
import { resolveTwoHopSlotId } from "./twoHopSlotId";
import { createTwoHopScalarScrollKernel } from "./twoHopScalarScrollKernel.svelte";

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

function getTwoHopActivationCandidateId(cell: TwoHopMountedItemCell): string {
	return resolveTwoHopSlotId(cell);
}

/** Owns the scalar kernel and its reactive row-model synchronization. */
export function createTwoHopVirtualListMountedRuntime(params: {
	readonly inputRuntime: TwoHopVirtualListInputRuntime;
	onStableVisibleRange(): void;
}) {
	const rowPreviewActivationRuntime = getContext<
		RowPreviewActivationRuntime | undefined
	>(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY);
	const kernel = createTwoHopScalarScrollKernel({
		initialRowModel: params.inputRuntime.rowModel,
		rowPreviewActivationRuntime,
		onStableVisibleRange: params.onStableVisibleRange,
	});
	$effect(() => {
		const nextRowModel = params.inputRuntime.rowModel;
		untrack(() => {
			if (kernel.getSnapshot()?.rowModel === nextRowModel) return;
			kernel.recompute({ rowModel: nextRowModel });
		});
	});
	$effect(() => () => kernel.dispose());

	const contentHeight = $derived.by(() => {
		const activeRowModel = params.inputRuntime.rowModel;
		const snapshot = kernel.getSnapshot();
		if (!snapshot) return activeRowModel.totalHeight;
		if (snapshot.rowModel !== activeRowModel) {
			return Math.max(snapshot.totalHeight, activeRowModel.totalHeight);
		}
		return snapshot.totalHeight;
	});

	return {
		kernel,
		get contentHeight() {
			return contentHeight;
		},
		get mountedRows() {
			return kernel.mountedRows;
		},
		get rowSlotControllers() {
			return kernel.fixedRowSlotPool.controllers;
		},
		getItemVisibilityState: kernel.getItemVisibilityState,
		getItemActivationCandidateId: getTwoHopActivationCandidateId,
		syncPreviewVisibleRange: kernel.syncPreviewVisibleRange,
		cancelPreviewVisibleRangeSync: kernel.cancelPreviewVisibleRangeSync,
	};
}

export type TwoHopVirtualListMountedRuntime = ReturnType<
	typeof createTwoHopVirtualListMountedRuntime
>;
