import {
	createTwoHopMeasurementState,
	createTwoHopVirtualListMeasurementRuntime,
} from "./twoHopVirtualListMeasurementRuntime.svelte";
import type { TwoHopMountedSurfaceRuntime } from "./twoHopMountedSurfaceRuntime.svelte";
import type { TwoHopVirtualListPlanRuntime } from "./twoHopVirtualListPlanRuntime.svelte";

export { createTwoHopMeasurementState };

/** @deprecated Use `twoHopVirtualListMeasurementRuntime.svelte`. */
export function createTwoHopMeasurementBridge(params: {
	readonly inputRuntime: TwoHopVirtualListPlanRuntime;
	readonly surfaceRuntime: TwoHopMountedSurfaceRuntime;
	readonly measurementState: ReturnType<typeof createTwoHopMeasurementState>;
}) {
	return createTwoHopVirtualListMeasurementRuntime({
		inputRuntime: params.inputRuntime,
		mountedRuntime: params.surfaceRuntime.internalRuntime,
		measurementState: params.measurementState,
	});
}

export type TwoHopMeasurementBridge = ReturnType<typeof createTwoHopMeasurementBridge>;
