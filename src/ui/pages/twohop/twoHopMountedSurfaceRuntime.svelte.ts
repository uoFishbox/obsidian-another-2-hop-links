import { getContext, untrack } from "svelte";
import type { TwoHopVirtualListPlanRuntime } from "./twoHopVirtualListPlanRuntime.svelte";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";
import { createTwoHopScalarScrollKernel } from "./twoHopScalarScrollKernel.svelte";

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
		syncPreviewVisibleRange: kernel.syncPreviewVisibleRange,
		cancelPreviewVisibleRangeSync: kernel.cancelPreviewVisibleRangeSync,
	};
}

export type TwoHopMountedSurfaceRuntime = ReturnType<
	typeof createTwoHopMountedSurfaceRuntime
>;
