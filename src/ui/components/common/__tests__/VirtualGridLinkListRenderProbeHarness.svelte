<script lang="ts">
	import LinkList from "../VirtualGridLinkList.svelte";
	import VirtualGridLinkListItemRenderProbe from "./VirtualGridLinkListItemRenderProbe.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";

	interface Props {
		items: string[];
		applicationStore?: ApplicationStore;
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
		<LinkList
			{items}
			getItemId={(item) => item}
			{initialVisibleCount}
			{loadMoreIncrement}
			{applicationStore}
		>
			{#snippet item({ item, index })}
				<VirtualGridLinkListItemRenderProbe
					item={item as string}
					{index}
					{onItemMount}
					{onItemUpdate}
				/>
			{/snippet}
		</LinkList>
	</div>
</div>
