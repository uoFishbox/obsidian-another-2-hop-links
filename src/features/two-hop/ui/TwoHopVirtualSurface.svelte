<script lang="ts">
	import VirtualSurface from "ui/virtualization/components/VirtualSurface.svelte";
	import { provideVirtualFrameCoordinator } from "ui/virtualization/svelte/frameCoordinatorContext.svelte";
	import { provideVirtualPreviewSurface } from "features/card-preview/ui/virtualPreviewSurfaceContext";
	import TwoHopVirtualCell from "features/two-hop/ui/TwoHopVirtualCell.svelte";
	import {
		useTwoHopVirtualList,
		type TwoHopVirtualListProps,
	} from "features/two-hop/ui/useTwoHopVirtualList.svelte";

	const props: TwoHopVirtualListProps = $props();
	const frameCoordinator = provideVirtualFrameCoordinator();
	const list = useTwoHopVirtualList(props, frameCoordinator);
	provideVirtualPreviewSurface(list.previewSurface);
</script>

<VirtualSurface
	className="cosense-card-links__section twohop-page-virtual-list twohop-virtual-surface"
	contentClassName="view-plan-flow-content twohop-virtual-content"
	rowClassName="twohop-virtual-row"
	cellClassName="twohop-virtual-cell"
	contentHeight={list.contentHeight}
	cellWidth={list.layout.cellWidth}
	rowHeight={list.layout.rowHeight}
	columns={list.layout.columns}
	gap={list.layout.gap}
	mountedRows={list.mountedRows}
	bind:rootEl={list.rootEl}
	observerRoot={list.observerRoot}
	resolveNavigationTarget={list.resolveNavigationTarget}
	flushVirtualScrollMeasurement={list.flushVirtualScrollMeasurement}
	interactionDescriptorScopeId="two-hop-virtual-card-slots"
	interactionDescriptorResolverProvider={list.interactionDescriptorResolverProvider}
	getCellDataTestId={(mountedCell) =>
		mountedCell.cell.kind === "item" ? "twohop-virtual-item-cell" : undefined}
>
	{#snippet renderCell({ mountedCell })}
		<TwoHopVirtualCell
			cell={mountedCell.cell}
			previewHostEnabled={list.isPreviewHostEnabled(mountedCell.rowIndex)}
			previewKey={mountedCell.cell.logicalKey}
			registerCardModelConsumer={list.registerCardModelConsumer}
			onLoadMore={list.loadMore}
		/>
	{/snippet}
</VirtualSurface>
