import {
	createViewPlanMeasurementRuntime,
	createViewPlanMeasurementState,
} from "ui/components/common/virtual-list/svelte/viewPlanMeasurement.svelte";
import { createViewPlanCardVirtualListPolicyResolver } from "ui/components/common/virtual-list/svelte/viewPlanPolicy";
import type { TwoHopMountedSurfaceRuntime } from "./twoHopMountedSurfaceRuntime.svelte";
import type { TwoHopVirtualListPlanRuntime } from "./twoHopVirtualListPlanRuntime.svelte";

export { createViewPlanMeasurementState as createTwoHopMeasurementState };

export function createTwoHopMeasurementBridge(params: {
	readonly inputRuntime: TwoHopVirtualListPlanRuntime;
	readonly surfaceRuntime: TwoHopMountedSurfaceRuntime;
	readonly measurementState: ReturnType<typeof createViewPlanMeasurementState>;
}) {
	const policyResolver = createViewPlanCardVirtualListPolicyResolver({
		getPreviewActivationAheadRows: () =>
			params.inputRuntime.applicationStore?.settings
				?.previewActivationAheadRows ?? 1,
	});
	const measurementRuntime = createViewPlanMeasurementRuntime({
		state: params.measurementState,
		runtime: {
			get rowModel() {
				return params.inputRuntime.rowModel;
			},
			get virtualList() {
				return params.surfaceRuntime.virtualList;
			},
			resolveRowModel: params.inputRuntime.resolveRowModel,
			syncPreviewVisibleRange: params.surfaceRuntime.syncPreviewVisibleRange,
			cancelPreviewVisibleRangeSync:
				params.surfaceRuntime.cancelPreviewVisibleRangeSync,
		},
		getConfiguredCardLayout: () => params.inputRuntime.configuredCardLayout,
		getValidatedSections: () => params.inputRuntime.validatedSections,
		policyResolver,
	});

	return {
		measurementRuntime,
	};
}

export type TwoHopMeasurementBridge = ReturnType<typeof createTwoHopMeasurementBridge>;
