<script lang="ts">
	import VirtualSurface from "../VirtualSurface.svelte";
	import VirtualSurfaceRecyclingProbe from "./VirtualSurfaceRecyclingProbe.svelte";
	import type { MountedVirtualCell, LogicalCellKey, RenderSlotKey } from "../types";
	import type { InteractionDescriptorResolver } from "ui/interactions/interactionRegistry";
	import {
		KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		PHYSICAL_SLOT_BODY_LIFECYCLE,
	} from "ui/virtualization/bodyLifecycle";

	interface TestMountedCell extends MountedVirtualCell {
		columnIndex: number;
		top: number;
		left: number;
		width: number;
		height: number;
	}

	interface Props {
		mountedCells: TestMountedCell[];
		mountedRows?: Array<{
			key: number;
			rowIndex: number;
			top: number;
			slotIndex?: number;
			slotKey?: number;
			cells: TestMountedCell[];
		}>;
		contentHeight: number;
		rowHeight: number;
		layoutMode?: "absolute-cells" | "grid-rows";
		remountCellBodyOnKeyChange?: boolean;
		interactionDescriptorResolvers?: readonly InteractionDescriptorResolver[];
		interactionId?: string;
		onCellMount?: (key: string) => void;
		onCellUpdate?: (key: string) => void;
	}

	let {
		mountedCells,
		mountedRows,
		contentHeight,
		rowHeight,
		layoutMode = "absolute-cells",
		remountCellBodyOnKeyChange = true,
		interactionDescriptorResolvers = [],
		interactionId,
		onCellMount,
		onCellUpdate,
	}: Props = $props();
</script>

{#if layoutMode === "grid-rows"}
	<VirtualSurface
		className="recycling-test-root"
		contentClassName="recycling-test-content"
		cellClassName="recycling-test-cell"
		mountedRows={mountedRows ?? []}
		{contentHeight}
		{rowHeight}
		layoutMode="grid-rows"
		bodyLifecyclePolicy={remountCellBodyOnKeyChange
			? KEYED_VIRTUAL_CELL_BODY_LIFECYCLE
			: PHYSICAL_SLOT_BODY_LIFECYCLE}
		interactionDescriptorScopeId={interactionId
			? "recycling-test-items"
			: undefined}
		{interactionDescriptorResolvers}
		getCellPosition={(cell) => ({
			top: cell.top,
			left: cell.left,
			width: cell.width,
			height: cell.height,
		})}
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
{:else}
	<VirtualSurface
		className="recycling-test-root"
		contentClassName="recycling-test-content"
		cellClassName="recycling-test-cell"
		{mountedCells}
		{contentHeight}
		{rowHeight}
		layoutMode="absolute-cells"
		interactionDescriptorScopeId={interactionId
			? "recycling-test-items"
			: undefined}
		{interactionDescriptorResolvers}
		getCellPosition={(cell) => ({
			top: cell.top,
			left: cell.left,
			width: cell.width,
			height: cell.height,
		})}
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
{/if}
