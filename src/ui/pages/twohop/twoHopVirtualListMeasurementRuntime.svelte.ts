import {
	createViewPlanMeasurementRuntime,
	createViewPlanMeasurementState,
} from "ui/components/common/virtual-list/svelte/viewPlanMeasurement.svelte";
import { createViewPlanCardVirtualListPolicyResolver } from "ui/components/common/virtual-list/svelte/viewPlanPolicy";
import type { TwoHopVirtualListInputRuntime } from "./twoHopVirtualListInputRuntime.svelte";
import type { TwoHopVirtualListMountedRuntime } from "./twoHopVirtualListMountedRuntime.svelte";
import type { VirtualFrameCoordinator } from "ui/virtualization/frameCoordinator";

export { createViewPlanMeasurementState as createTwoHopMeasurementState };

/** Connects measurement policy to the compiled plan and mounted kernel. */
export function createTwoHopVirtualListMeasurementRuntime(params: {
	readonly inputRuntime: TwoHopVirtualListInputRuntime;
	readonly mountedRuntime: TwoHopVirtualListMountedRuntime;
	readonly measurementState: ReturnType<typeof createViewPlanMeasurementState>;
	readonly frameCoordinator?: VirtualFrameCoordinator;
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
				return params.mountedRuntime.kernel;
			},
			resolveRowModel: params.inputRuntime.resolveRowModel,
			syncPreviewVisibleRange: params.mountedRuntime.syncPreviewVisibleRange,
			cancelPreviewVisibleRangeSync:
				params.mountedRuntime.cancelPreviewVisibleRangeSync,
		},
		getConfiguredCardLayout: () => params.inputRuntime.configuredCardLayout,
		getValidatedSections: () => params.inputRuntime.validatedSections,
		policyResolver,
		frameCoordinator: params.frameCoordinator,
	});

	return {
		measurementRuntime,
	};
}

export type TwoHopVirtualListMeasurementRuntime = ReturnType<
	typeof createTwoHopVirtualListMeasurementRuntime
>;
