<script lang="ts">
	import CardGridSurface from "cards/grid/surface/CardGridSurface.svelte";
	import { provideVirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinatorContext.svelte";
	import { provideVirtualPreviewSurface } from "card-preview/ui/virtualPreviewSurfaceContext";
	import TwoHopVirtualCell from "two-hop/ui/TwoHopVirtualCell.svelte";
	import {
		useTwoHopVirtualGrid,
		type TwoHopVirtualGridProps,
	} from "./virtual-grid/useTwoHopVirtualGrid.svelte";

	const props: TwoHopVirtualGridProps = $props();
	const frameCoordinator = provideVirtualFrameCoordinator();
	const list = useTwoHopVirtualGrid(props, frameCoordinator);
	provideVirtualPreviewSurface(list.previewSurface);
</script>

<CardGridSurface
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
	scrollContainerEl={list.scrollContainerEl}
	resolveNavigationTarget={list.resolveNavigationTarget}
	resolveSequentialNavigationTarget={list.resolveSequentialNavigationTarget}
	flushVirtualScrollMeasurement={list.flushVirtualScrollMeasurement}
	interactionDescriptorResolverProvider={list.interactionDescriptorResolverProvider}
	getCellDataTestId={(mountedCell) =>
		mountedCell.cell.kind === "item" ? "twohop-virtual-item-cell" : undefined}
>
	{#snippet renderCell({ mountedCell })}
		<TwoHopVirtualCell
			cell={mountedCell.cell}
			interactionHandle={mountedCell.cell.kind === "item"
				? list.getInteractionHandle(mountedCell.cell.logicalKey)
				: undefined}
			previewHostEnabled={list.isPreviewHostEnabled(mountedCell.rowIndex)}
			previewKey={mountedCell.cell.logicalKey}
			registerCardModelConsumer={list.registerCardModelConsumer}
			onLoadMore={list.loadMore}
		/>
	{/snippet}
</CardGridSurface>
