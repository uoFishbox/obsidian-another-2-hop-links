<script lang="ts">
	import VirtualSurface from "../VirtualSurface.svelte";
	import VirtualSurfaceRecyclingProbe from "./VirtualSurfaceRecyclingProbe.svelte";
	import type { MountedVirtualCell } from "../../types";
	import {
		KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		PHYSICAL_SLOT_BODY_LIFECYCLE,
	} from "ui/virtualization/core/bodyLifecycle";

	interface TestMountedCell extends MountedVirtualCell {
		columnIndex: number;
	}

	interface TestMountedRow {
		key: number;
		rowIndex: number;
		top: number;
		slotIndex?: number;
		slotKey?: number;
		cells: TestMountedCell[];
	}

	interface Props {
		mountedRows: TestMountedRow[];
		contentHeight: number;
		rowHeight: number;
		remountCellBodyOnKeyChange?: boolean;
		interactionId?: string;
		onCellMount?: (key: string) => void;
		onCellUpdate?: (key: string) => void;
	}

	let {
		mountedRows,
		contentHeight,
		rowHeight,
		remountCellBodyOnKeyChange = true,
		interactionId,
		onCellMount,
		onCellUpdate,
	}: Props = $props();
</script>

<VirtualSurface
	className="recycling-test-root"
	contentClassName="recycling-test-content"
	cellClassName="recycling-test-cell"
	{mountedRows}
	{contentHeight}
	{rowHeight}
	bodyLifecyclePolicy={remountCellBodyOnKeyChange
		? KEYED_VIRTUAL_CELL_BODY_LIFECYCLE
		: PHYSICAL_SLOT_BODY_LIFECYCLE}
	interactionDescriptorScopeId={interactionId ? "recycling-test-items" : undefined}
>
	{#snippet renderCell({ mountedCell })}
		<VirtualSurfaceRecyclingProbe
			key={mountedCell.key}
			{interactionId}
			{onCellMount}
			{onCellUpdate}
		/>
	{/snippet}
</VirtualSurface>
