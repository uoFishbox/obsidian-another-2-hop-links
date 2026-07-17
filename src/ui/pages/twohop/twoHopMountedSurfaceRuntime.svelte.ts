import {
	createTwoHopVirtualListMountedRuntime,
	type TwoHopVirtualListMountedRuntime,
} from "./twoHopVirtualListMountedRuntime.svelte";
import type { TwoHopVirtualListPlanRuntime } from "./twoHopVirtualListPlanRuntime.svelte";

/** @deprecated Use `twoHopVirtualListMountedRuntime.svelte`. */
export function createTwoHopMountedSurfaceRuntime(params: {
	readonly inputRuntime: TwoHopVirtualListPlanRuntime;
	onStableVisibleRange(): void;
}) {
	const internalRuntime = createTwoHopVirtualListMountedRuntime(params);
	return {
		internalRuntime,
		mountRuntime: internalRuntime.kernel,
		virtualList: internalRuntime.kernel,
		get contentHeight() {
			return internalRuntime.contentHeight;
		},
		get mountedRowsForSurface() {
			return internalRuntime.mountedRows;
		},
		get fixedRowSlotControllers() {
			return internalRuntime.rowSlotControllers;
		},
		getItemActivationCandidateId: internalRuntime.getItemActivationCandidateId,
		syncPreviewVisibleRange: internalRuntime.syncPreviewVisibleRange,
		cancelPreviewVisibleRangeSync: internalRuntime.cancelPreviewVisibleRangeSync,
	};
}

export type TwoHopMountedSurfaceRuntime = ReturnType<
	typeof createTwoHopMountedSurfaceRuntime
>;

export type { TwoHopVirtualListMountedRuntime };
