import { getContext, untrack } from "svelte";
import type { TwoHopVirtualListInputRuntime } from "./twoHopVirtualListInputRuntime.svelte";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";
import { resolveTwoHopSlotId } from "./twoHopSlotId";
import type { TwoHopSlotIdCell } from "./twoHopSlotId";
import { createTwoHopScalarScrollKernel } from "./twoHopScalarScrollKernel.svelte";

function getTwoHopActivationCandidateId(cell: TwoHopSlotIdCell): string {
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
		enableResidentWindow: true,
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
		getMountedCellByInteractionId: kernel.getMountedCellByInteractionId,
		getItemActivationCandidateId: getTwoHopActivationCandidateId,
		syncPreviewVisibleRange: kernel.syncPreviewVisibleRange,
		cancelPreviewVisibleRangeSync: kernel.cancelPreviewVisibleRangeSync,
	};
}

export type TwoHopVirtualListMountedRuntime = ReturnType<
	typeof createTwoHopVirtualListMountedRuntime
>;
