<script lang="ts">
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { ViewPlanLayoutMetrics } from "ui/virtualization/svelte/viewPlanLayout";
	import type { TwoHopProgressiveRow } from "features/two-hop/ui/twoHopProgressivePlan";
	import TwoHopProgressiveCell from "features/two-hop/ui/TwoHopProgressiveCell.svelte";

	interface Props {
		row: TwoHopProgressiveRow;
		layout: ViewPlanLayoutMetrics;
		applicationStore: ApplicationStore;
		registerCardModelConsumer: (
			logicalKey: string,
			consumer: (model: CardRenderModel | undefined) => void,
		) => () => void;
		observePreviewRow: (
			element: HTMLElement,
			rowIndex: number,
			setPreviewCandidate: (active: boolean) => void,
		) => () => void;
		onLoadMore: (sectionId: string) => void;
	}

	let {
		row,
		layout,
		applicationStore,
		registerCardModelConsumer,
		observePreviewRow,
		onLoadMore,
	}: Props = $props();
	let rowEl = $state<HTMLDivElement | null>(null);
	let previewCandidate = $state(false);

	$effect(() => {
		const element = rowEl;
		if (!element) return;
		return observePreviewRow(element, row.rowIndex, (active) => {
			previewCandidate = active;
		});
	});
</script>

<div
	bind:this={rowEl}
	class="twohop-progressive-row"
	data-ccl-progressive-row={row.rowIndex}
	style={`top:${row.top}px;height:${layout.rowHeight}px;grid-template-columns:repeat(${layout.columns},minmax(0,1fr));gap:${layout.gap}px;`}
>
	{#each row.cells as cell (cell.logicalKey)}
		<div
			class="twohop-progressive-cell"
			data-ccl-logical-key={cell.logicalKey}
			data-ccl-row-index={cell.rowIndex}
			data-ccl-column-index={cell.columnIndex}
			data-testid={cell.kind === "item"
				? "twohop-progressive-item-cell"
				: undefined}
		>
			<TwoHopProgressiveCell
				{cell}
				{applicationStore}
				{previewCandidate}
				{registerCardModelConsumer}
				{onLoadMore}
			/>
		</div>
	{/each}
</div>
