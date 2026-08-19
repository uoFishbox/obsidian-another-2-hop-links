<script lang="ts">
	import LinkList from "../VirtualGridLinkList.svelte";

	interface HarnessItem {
		id: string;
		label: string;
	}

	interface Props {
		items: HarnessItem[];
		itemsRevision?: unknown;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
	}

	let {
		items,
		itemsRevision,
		initialVisibleCount = items.length,
		loadMoreIncrement = items.length,
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
			{itemsRevision}
			getItemId={(item) => item.id}
			{initialVisibleCount}
			{loadMoreIncrement}
		>
			{#snippet item({ item, index })}
				<div
					class="test-cell"
					data-testid="object-item-cell"
					data-index={index}
					data-item-id={item.id}
				>
					{item.label}
				</div>
			{/snippet}
		</LinkList>
	</div>
</div>

<style>
	.test-cell {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.04);
	}
</style>
