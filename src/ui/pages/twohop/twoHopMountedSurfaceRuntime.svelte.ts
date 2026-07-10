import { getContext } from "svelte";
import type { MountedFlatItemCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import type { TwoHopVirtualListPlanRuntime } from "./twoHopVirtualListPlanRuntime.svelte";
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

export function createTwoHopMountedSurfaceRuntime(params: {
	readonly inputRuntime: TwoHopVirtualListPlanRuntime;
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
		mountRuntime: kernel,
		virtualList: kernel,
		get contentHeight() {
			return contentHeight;
		},
		get mountedRowsForSurface() {
			return kernel.mountedRows;
		},
		get fixedRowSlotControllers() {
			return kernel.fixedRowSlotPool.controllers;
		},
		getItemVisibilityState: kernel.getItemVisibilityState,
		getItemActivationCandidateId: getTwoHopActivationCandidateId,
		syncPreviewVisibleRange: kernel.syncPreviewVisibleRange,
		cancelPreviewVisibleRangeSync: kernel.cancelPreviewVisibleRangeSync,
	};
}

export type TwoHopMountedSurfaceRuntime = ReturnType<
	typeof createTwoHopMountedSurfaceRuntime
>;
