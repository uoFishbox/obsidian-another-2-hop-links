<script lang="ts">
	import FlatCardGrid from "../FlatCardGrid.svelte";
	import FlatCardGridItemRenderProbe from "./FlatCardGridItemRenderProbe.svelte";
	import type { ApplicationUiState } from "application/stores/ApplicationUiState.svelte";

	interface Props {
		items: string[];
		applicationStore?: ApplicationUiState;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		onItemMount?: (id: string) => void;
		onItemUpdate?: (id: string) => void;
	}

	let {
		items,
		applicationStore,
		initialVisibleCount = items.length,
		loadMoreIncrement = items.length,
		onItemMount,
		onItemUpdate,
	}: Props = $props();
</script>

<div
	class="scroll-root"
	data-testid="scroll-root"
	style="overflow: auto; position: relative;"
>
	<div
		class="section-host"
		data-testid="section-host"
		style="position: relative; width: 330px; --ccl-box-size: 100px; --ccl-box-height: 120px; --ccl-box-gap: 10px; --ccl-box-cols-max: 4;"
	>
		<FlatCardGrid
			{items}
			getItemId={(item) => item}
			{initialVisibleCount}
			{loadMoreIncrement}
			{applicationStore}
		>
			{#snippet item({ item, index })}
				<FlatCardGridItemRenderProbe
					item={item as string}
					{index}
					{onItemMount}
					{onItemUpdate}
				/>
			{/snippet}
		</FlatCardGrid>
	</div>
</div>
