<script lang="ts">
	import VirtualSurface from "ui/virtualization/components/VirtualSurface.svelte";
	import { KEYED_VIRTUAL_CELL_BODY_LIFECYCLE } from "ui/virtualization/core/bodyLifecycle";
	import { providePreviewActivationContexts } from "features/preview/scheduling/previewActivationContexts";
	import TwoHopLogicalCell from "features/two-hop/ui/TwoHopLogicalCell.svelte";
	import { useTwoHopVirtualList } from "features/two-hop/ui/useTwoHopVirtualList.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
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

	const props: Props = $props();
	providePreviewActivationContexts();
	const list = useTwoHopVirtualList(props);
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
	mountedRows={list.mountedRows}
	bodyLifecyclePolicy={KEYED_VIRTUAL_CELL_BODY_LIFECYCLE}
	bind:rootEl={list.rootEl}
	observerRoot={list.observerRoot}
	getCellClassName={list.getCellClassName}
	getCellDataTestId={list.getCellDataTestId}
	resolveNavigationTarget={list.resolveNavigationTarget}
	flushVirtualScrollMeasurement={list.flushVirtualScrollMeasurement}
>
	{#snippet renderCell({ mountedCell })}
		<TwoHopLogicalCell
			{mountedCell}
			applicationStore={props.applicationStore}
			resolveItemCardModel={props.resolveItemCardModel}
			onLoadMore={list.loadMore}
		/>
	{/snippet}
</VirtualSurface>
