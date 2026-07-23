<script lang="ts">
	import VirtualSurface from "ui/virtualization/components/VirtualSurface.svelte";
	import type { MountedVirtualCell } from "ui/virtualization/types";
	import type {
		VirtualSurfaceMountedRow,
		VirtualSurfaceResidentRowViewState,
	} from "ui/virtualization/svelte/VirtualSurfaceTypes";

	interface TestMountedCell extends MountedVirtualCell {
		readonly label: string;
	}

	interface TestMountedRow extends VirtualSurfaceMountedRow<TestMountedCell> {
		readonly slotIndex: number;
	}

	interface Props {
		residentRows: readonly VirtualSurfaceResidentRowViewState<
			TestMountedCell,
			TestMountedRow
		>[];
		getCellClassName: (cell: TestMountedCell) => string | undefined;
	}

	let { residentRows, getCellClassName }: Props = $props();
</script>

<VirtualSurface
	className="resident-rows-test-root"
	contentHeight={500}
	rowHeight={50}
	layoutMode="grid-rows"
	{residentRows}
	{getCellClassName}
>
	{#snippet renderCell({ mountedCell })}
		<span>{mountedCell.label}</span>
	{/snippet}
</VirtualSurface>
