<script lang="ts" generics="T">
	import { type Snippet } from "svelte";

	interface Props<T> {
		items?: readonly T[];
		getItemId?: (item: T, index: number) => string;
		item?: Snippet<
			[
				{
					item: T;
					index: number;
					scrollContainerEl: HTMLElement | null;
				},
			]
		>;
	}

	let { items = [], getItemId, item }: Props<T> = $props();
</script>

<div data-testid="filtered-count">{items.length}</div>

{#each items as entry, index}
	<div data-testid="searchable-item-slot" data-item-key={getItemId?.(entry, index)}>
		{@render item?.({
			item: entry,
			index,
			scrollContainerEl: null,
		})}
	</div>
{/each}
