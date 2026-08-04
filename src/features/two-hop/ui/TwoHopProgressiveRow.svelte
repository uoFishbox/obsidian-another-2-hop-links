<script lang="ts">
	import { IS_PROD } from "appConstants";
	import type { CardShellModel } from "ui/components/items/cardRenderModel";
	import type { ViewPlanLayoutMetrics } from "ui/virtualization/svelte/viewPlanLayout";
	import type { TwoHopProgressiveRow } from "features/two-hop/ui/twoHopProgressivePlan";
	import TwoHopProgressiveCell from "features/two-hop/ui/TwoHopProgressiveCell.svelte";

	interface Props {
		row: TwoHopProgressiveRow;
		layout: ViewPlanLayoutMetrics;
		registerCardModelConsumer: (
			logicalKey: string,
			consumer: (model: CardShellModel | undefined) => void,
		) => () => void;
		registerPreviewRow: (
			rowIndex: number,
			setPreviewHostCandidate: (resident: boolean) => void,
		) => () => void;
		onLoadMore: (sectionId: string) => void;
	}

	let {
		row,
		layout,
		registerCardModelConsumer,
		registerPreviewRow,
		onLoadMore,
	}: Props = $props();
	let previewHostCandidate = $state(false);

	$effect(() => {
		return registerPreviewRow(row.rowIndex, (resident) => {
			previewHostCandidate = resident;
		});
	});
</script>

<div
	class="twohop-progressive-row"
	data-ccl-progressive-row={row.rowIndex}
	style={`top:${row.top}px;height:${layout.rowHeight}px;grid-template-columns:repeat(${layout.columns},minmax(0,1fr));gap:${layout.gap}px;`}
>
	{#each row.cells as cell (cell.logicalKey)}
		<div
			class="twohop-progressive-cell"
			data-ccl-logical-key={cell.logicalKey}
			data-ccl-row-index={!IS_PROD ? cell.rowIndex : undefined}
			data-ccl-column-index={!IS_PROD ? cell.columnIndex : undefined}
			data-testid={!IS_PROD && cell.kind === "item"
				? "twohop-progressive-item-cell"
				: undefined}
		>
			<TwoHopProgressiveCell
				{cell}
				{previewHostCandidate}
				{registerCardModelConsumer}
				{onLoadMore}
			/>
		</div>
	{/each}
</div>
