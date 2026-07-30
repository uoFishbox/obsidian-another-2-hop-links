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
	import type { TwoHopCommittedCellBinding } from "features/two-hop/ui/twoHopVirtualFrame";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor,
	} from "features/two-hop/ui/twoHopVirtualListModel";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		previewDependencies?: TwoHopPreviewDependencies;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		paginationScope?: string;
		resolveItemCardModel?: (
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel;
		previewActive?: boolean;
	}

	const TWO_HOP_BODY_LIFECYCLE = {
		type: "keyed",
		resolveKey: (binding: TwoHopCommittedCellBinding): unknown => binding.body,
	} satisfies VirtualCellBodyLifecyclePolicy<TwoHopCommittedCellBinding>;

	const props: Props = $props();
	const frameCoordinator = provideVirtualFrameCoordinator();
	const list = useTwoHopVirtualList(props, frameCoordinator);
	const frame = $derived(list.frame);
	provideVirtualPreviewSurface(list.previewSurface);
</script>

<VirtualSurface
	className="cosense-card-links__section view-plan-virtual-list twohop-page-virtual-list twohop-keyed-surface"
	contentClassName="view-plan-virtual-list-content view-plan-flow-content twohop-keyed-content"
	rowClassName="view-plan-flow-row twohop-keyed-row"
	cellClassName="view-plan-virtual-list-cell view-plan-flow-cell"
	contentHeight={frame.contentHeight}
	cellWidth={frame.layout.cellWidth}
	rowHeight={frame.layout.rowHeight}
	columns={frame.layout.columns}
	gap={frame.layout.gap}
	layoutMode="grid-rows"
	mountedRows={frame.rowSlots}
	bodyLifecyclePolicy={TWO_HOP_BODY_LIFECYCLE}
	bind:rootEl={list.rootEl}
	observerRoot={list.observerRoot}
	getCellDataTestId={list.getCellDataTestId}
	resolveNavigationTarget={list.resolveNavigationTarget}
	flushVirtualScrollMeasurement={list.flushVirtualScrollMeasurement}
	interactionDescriptorScopeId="two-hop-card-slots"
	interactionDescriptorResolverProvider={list.interactionDescriptorResolverProvider}
>
	{#snippet renderCell({ mountedCell: binding })}
		<TwoHopLogicalCell
			mountedCell={binding.mountedCell}
			applicationStore={props.applicationStore}
			cardModel={binding.cardModel ?? undefined}
			previewSlotId={binding.slot.hostId}
			onLoadMore={list.loadMore}
		/>
	{/snippet}
</VirtualSurface>
