<script lang="ts">
	import VirtualListCellMount from "../VirtualListCellMount.svelte";
	import type { LogicalCellKey } from "../../types";

	interface Props {
		logicalKey: LogicalCellKey;
	}

	let { logicalKey }: Props = $props();
</script>

<VirtualListCellMount
	{logicalKey}
	left={0}
	top={0}
	width={100}
	height={50}
	className="cell-mount-harness"
	dataTestId="cell-mount-harness"
>
	<span>cell</span>
</VirtualListCellMount>
