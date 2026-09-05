<script lang="ts">
	import CardGridSurface from "../CardGridSurface.svelte";
	import CardGridSurfaceRecyclingProbe from "./CardGridSurfaceRecyclingProbe.svelte";
	import type { MountedVirtualCell } from "cards/virtualization/public";

	interface TestMountedCell extends MountedVirtualCell {
		columnIndex: number;
	}

	interface TestMountedRow {
		key: number;
		rowIndex: number;
		top: number;
		physicalRowSlot: number;
		bindings: Array<TestMountedCell | null>;
	}

	interface Props {
		mountedRows: TestMountedRow[];
		contentHeight: number;
		rowHeight: number;
		columns?: number;
		slotBodyRevision?: unknown;
		interactionId?: string;
		onCellMount?: (key: string) => void;
		onCellUpdate?: (key: string) => void;
		onCellUnmount?: (key: string) => void;
	}

	let {
		mountedRows,
		contentHeight,
		rowHeight,
		columns = 1,
		slotBodyRevision,
		interactionId,
		onCellMount,
		onCellUpdate,
		onCellUnmount,
	}: Props = $props();
</script>

<CardGridSurface
	className="recycling-test-root"
	contentClassName="recycling-test-content"
	cellClassName="recycling-test-cell"
	{mountedRows}
	{contentHeight}
	{rowHeight}
	{columns}
	{slotBodyRevision}
>
	{#snippet renderCell({ mountedCell })}
		<CardGridSurfaceRecyclingProbe
			key={mountedCell.key}
			{interactionId}
			{onCellMount}
			{onCellUpdate}
			{onCellUnmount}
		/>
	{/snippet}
</CardGridSurface>
