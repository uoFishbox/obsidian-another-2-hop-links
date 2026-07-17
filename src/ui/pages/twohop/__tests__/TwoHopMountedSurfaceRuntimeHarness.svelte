<script lang="ts">
	import type { TwoHopViewPlanRowModel } from "../twoHopViewPlan";
	import {
		createTwoHopVirtualListMountedRuntime,
		type TwoHopVirtualListMountedRuntime,
	} from "../twoHopVirtualListMountedRuntime.svelte";
	import type { TwoHopVirtualListInputRuntime } from "../twoHopVirtualListInputRuntime.svelte";

	interface Props {
		rowModel: TwoHopViewPlanRowModel;
		onRuntime(runtime: TwoHopVirtualListMountedRuntime): void;
	}

	let { rowModel, onRuntime }: Props = $props();
	const inputRuntime = {
		get rowModel() {
			return rowModel;
		},
	} as TwoHopVirtualListInputRuntime;
	const runtime = createTwoHopVirtualListMountedRuntime({
		inputRuntime,
		onStableVisibleRange() {},
	});
	onRuntime(runtime);
</script>
