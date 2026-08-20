<script lang="ts" generics="T">
	import { type Snippet } from "svelte";

	interface Props<T> {
		items?: readonly T[];
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

	let { items = [], item }: Props<T> = $props();
</script>

<div data-testid="filtered-count">{items.length}</div>

{#each items as entry, index}
	{@render item?.({
		item: entry,
		index,
		scrollContainerEl: null,
	})}
{/each}
