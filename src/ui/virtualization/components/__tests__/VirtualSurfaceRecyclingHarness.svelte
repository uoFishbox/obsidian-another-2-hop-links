<script lang="ts">
	import VirtualSurface from "../VirtualSurface.svelte";
	import VirtualSurfaceRecyclingProbe from "./VirtualSurfaceRecyclingProbe.svelte";
	import type { MountedVirtualCell } from "../../types";

	interface TestMountedCell extends MountedVirtualCell {
		columnIndex: number;
	}

	interface TestMountedRow {
		key: number;
		rowIndex: number;
		top: number;
		slotIndex: number;
		bindings: Array<TestMountedCell | null>;
	}

	interface Props {
		mountedRows: TestMountedRow[];
		contentHeight: number;
		rowHeight: number;
		bodyRevision?: unknown;
		interactionId?: string;
		onCellMount?: (key: string) => void;
		onCellUpdate?: (key: string) => void;
		onCellUnmount?: (key: string) => void;
	}

	let {
		mountedRows,
		contentHeight,
		rowHeight,
		bodyRevision,
		interactionId,
		onCellMount,
		onCellUpdate,
		onCellUnmount,
	}: Props = $props();
</script>

<VirtualSurface
	className="recycling-test-root"
	contentClassName="recycling-test-content"
	cellClassName="recycling-test-cell"
	{mountedRows}
	{contentHeight}
	{rowHeight}
	{bodyRevision}
	interactionDescriptorScopeId={interactionId ? "recycling-test-items" : undefined}
>
	{#snippet renderCell({ mountedCell })}
		<VirtualSurfaceRecyclingProbe
			key={mountedCell.key}
			{interactionId}
			{onCellMount}
			{onCellUpdate}
			{onCellUnmount}
		/>
	{/snippet}
</VirtualSurface>
