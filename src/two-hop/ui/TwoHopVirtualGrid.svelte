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
	const grid = useTwoHopVirtualGrid(props, frameCoordinator);
	provideVirtualPreviewSurface(grid.previewSurface);
</script>

<CardGridSurface
	className="cosense-card-links__section twohop-page-virtual-list twohop-virtual-surface"
	contentClassName="view-plan-flow-content twohop-virtual-content"
	rowClassName="twohop-virtual-row"
	cellClassName="twohop-virtual-cell"
	contentHeight={grid.contentHeight}
	cellWidth={grid.layout.cellWidth}
	rowHeight={grid.layout.rowHeight}
	columns={grid.layout.columns}
	gap={grid.layout.gap}
	mountedRows={grid.mountedRows}
	bind:rootEl={grid.rootEl}
	scrollContainerEl={grid.scrollContainerEl}
	resolveNavigationTarget={grid.resolveNavigationTarget}
	resolveSequentialNavigationTarget={grid.resolveSequentialNavigationTarget}
	onMoveFocusAboveGrid={props.onMoveFocusAboveGrid}
	shouldMoveFocusAboveGrid={grid.shouldMoveFocusAboveGrid}
	flushVirtualScrollMeasurement={grid.flushVirtualScrollMeasurement}
	interactionDescriptorResolverProvider={grid.interactionDescriptorResolverProvider}
	getCellDataTestId={(mountedCell) =>
		mountedCell.cell.kind === "item" ? "twohop-virtual-item-cell" : undefined}
>
	{#snippet renderCell({ mountedCell })}
		<TwoHopVirtualCell
			cell={mountedCell.cell}
			interactionHandle={mountedCell.cell.kind === "item"
				? grid.getInteractionHandle(mountedCell.physicalCellSlot)
				: undefined}
			previewHostEnabled={grid.isPreviewHostEnabled(mountedCell.rowIndex)}
			previewKey={mountedCell.cell.logicalKey}
			registerCardModelConsumer={grid.registerCardModelConsumer}
			onLoadMore={grid.loadMore}
			language={props.language}
		/>
	{/snippet}
</CardGridSurface>
