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
		slotIndex: number;
		bindings: Array<TestMountedCell | null>;
	}

	interface Props {
		mountedRows: TestMountedRow[];
		contentHeight: number;
		rowHeight: number;
		remountCellBodyOnKeyChange?: boolean;
		physicalSlotRevision?: unknown;
		interactionId?: string;
		onCellMount?: (key: string) => void;
		onCellUpdate?: (key: string) => void;
		onCellUnmount?: (key: string) => void;
	}

	let {
		mountedRows,
		contentHeight,
		rowHeight,
		remountCellBodyOnKeyChange = true,
		physicalSlotRevision,
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
	bodyLifecyclePolicy={remountCellBodyOnKeyChange
		? KEYED_VIRTUAL_CELL_BODY_LIFECYCLE
		: physicalSlotRevision === undefined
			? PHYSICAL_SLOT_BODY_LIFECYCLE
			: { type: "physical-slot", revision: physicalSlotRevision }}
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
