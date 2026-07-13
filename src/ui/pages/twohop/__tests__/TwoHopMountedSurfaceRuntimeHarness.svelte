<script lang="ts">
	import type { TwoHopViewPlanRowModel } from "../twoHopViewPlan";
	import { createTwoHopMountedSurfaceRuntime } from "../twoHopMountedSurfaceRuntime.svelte";
	import type { TwoHopVirtualListPlanRuntime } from "../twoHopVirtualListPlanRuntime.svelte";
	import type { TwoHopMountedSurfaceRuntime } from "../twoHopMountedSurfaceRuntime.svelte";

	interface Props {
		rowModel: TwoHopViewPlanRowModel;
		onRuntime(runtime: TwoHopMountedSurfaceRuntime): void;
	}

	let { rowModel, onRuntime }: Props = $props();
	const inputRuntime = {
		get rowModel() {
			return rowModel;
		},
	} as TwoHopVirtualListPlanRuntime;
	const runtime = createTwoHopMountedSurfaceRuntime({
		inputRuntime,
		onStableVisibleRange() {},
	});
	onRuntime(runtime);
</script>
