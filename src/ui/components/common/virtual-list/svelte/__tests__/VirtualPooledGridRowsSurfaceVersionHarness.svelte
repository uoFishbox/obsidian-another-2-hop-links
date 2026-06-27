<script lang="ts">
	import { IS_PROD } from "../../../../../../appConstants";
	import {
		logicalCellKey,
		renderSlotKey,
		type LogicalCellKey,
		type MountedVirtualCell,
		type RenderSlotKey,
	} from "../../types";
	import VirtualPooledGridRowsSurface from "../VirtualPooledGridRowsSurface.svelte";
	import type { VirtualSurfaceMountedRow } from "../VirtualSurfaceCells.svelte";

	interface TestCell extends MountedVirtualCell {
		bodyContent: string;
	}

	interface Props {
		mountedRows: VirtualSurfaceMountedRow<TestCell>[];
		mountedRowsVersion?: number;
	}

	let { mountedRows, mountedRowsVersion }: Props = $props();
</script>

<VirtualPooledGridRowsSurface
	contentClassName="test-surface"
	rowClassName="test-row"
	cellClassName="test-cell"
	contentHeight={1000}
	rowHeight={50}
	{mountedRows}
	{mountedRowsVersion}
>
	{#snippet renderCell({ mountedCell })}
		<span data-testid="cell-body">{mountedCell.bodyContent}</span>
	{/snippet}
</VirtualPooledGridRowsSurface>
