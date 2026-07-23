<script lang="ts">
	import VirtualSurface from "ui/virtualization/components/VirtualSurface.svelte";
	import type { VirtualCellBodyLifecyclePolicy } from "ui/virtualization/core/bodyLifecycle";
	import { provideVirtualFrameCoordinator } from "ui/virtualization/svelte/frameCoordinatorContext.svelte";
	import TwoHopLogicalCell from "features/two-hop/ui/TwoHopLogicalCell.svelte";
	import { useTwoHopVirtualList } from "features/two-hop/ui/useTwoHopVirtualList.svelte";
	import { provideVirtualPreviewSurface } from "features/preview/ui/virtualPreviewSurfaceContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
	import type { TwoHopMountedCell } from "features/two-hop/ui/twoHopMountedRows";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor,
	} from "features/two-hop/ui/twoHopVirtualListModel";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore?: ApplicationStore;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		resolveItemCardModel?: (
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel;
		previewActive?: boolean;
	}

	const TWO_HOP_BODY_LIFECYCLE = {
		type: "keyed",
		resolveKey: (cell: TwoHopMountedCell): unknown =>
			cell.cell.kind === "item"
				? cell.renderSlotKey
				: (cell.renderBodyKey ?? cell.key),
	} satisfies VirtualCellBodyLifecyclePolicy<TwoHopMountedCell>;

	const props: Props = $props();
	const frameCoordinator = provideVirtualFrameCoordinator();
	const list = useTwoHopVirtualList(props, frameCoordinator);
	provideVirtualPreviewSurface(list.previewSurface);
</script>

<VirtualSurface
	className="cosense-card-links__section view-plan-virtual-list twohop-page-virtual-list twohop-keyed-surface"
	contentClassName="view-plan-virtual-list-content view-plan-flow-content twohop-keyed-content"
	rowClassName="view-plan-flow-row twohop-keyed-row"
	cellClassName="view-plan-virtual-list-cell view-plan-flow-cell"
	contentHeight={list.contentHeight}
	cellWidth={list.layout.cellWidth}
	rowHeight={list.layout.rowHeight}
	columns={list.layout.columns}
	gap={list.layout.gap}
	layoutMode="grid-rows"
	residentRows={list.residentRows}
	bodyLifecyclePolicy={TWO_HOP_BODY_LIFECYCLE}
	bind:rootEl={list.rootEl}
	observerRoot={list.observerRoot}
	getCellClassName={list.getCellClassName}
	getCellDataTestId={list.getCellDataTestId}
	resolveNavigationTarget={list.resolveNavigationTarget}
	flushVirtualScrollMeasurement={list.flushVirtualScrollMeasurement}
	interactionDescriptorScopeId="two-hop-card-slots"
	interactionDescriptorResolverProvider={list.interactionDescriptorResolverProvider}
>
	{#snippet renderCell({ mountedCell })}
		{@const slotState = list.getRenderSlotState(mountedCell)}
		<TwoHopLogicalCell
			{mountedCell}
			applicationStore={props.applicationStore}
			cardModel={slotState?.cardModel}
			previewSlotId={String(mountedCell.renderSlotKey)}
			onLoadMore={list.loadMore}
		/>
	{/snippet}
</VirtualSurface>
