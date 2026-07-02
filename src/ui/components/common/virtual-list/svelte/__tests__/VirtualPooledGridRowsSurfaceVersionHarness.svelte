<script lang="ts">
	import { type MountedVirtualCell } from "../../types";
	import { VirtualSurfaceRowSlot } from "../VirtualSurfaceRowSlot.svelte";
	import VirtualPooledGridRowsSurface from "../VirtualPooledGridRowsSurface.svelte";

	interface TestCell extends MountedVirtualCell {
		bodyContent: string;
	}

	interface Props {
		mountedRowSlots: VirtualSurfaceRowSlot<TestCell>[];
	}

	let { mountedRowSlots }: Props = $props();
</script>

<VirtualPooledGridRowsSurface
	contentClassName="test-surface"
	rowClassName="test-row"
	cellClassName="test-cell"
	contentHeight={1000}
	rowHeight={50}
	{mountedRowSlots}
>
	{#snippet renderCell({ mountedCell })}
		<span data-testid="cell-body">{mountedCell.bodyContent}</span>
	{/snippet}
</VirtualPooledGridRowsSurface>
