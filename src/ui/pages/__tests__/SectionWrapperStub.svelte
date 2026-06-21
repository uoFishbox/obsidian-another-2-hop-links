<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		title: string;
		items: unknown[];
		sectionId: string;
		className?: string;
		getKey: (item: unknown, index: number) => string;
		sectionIdScope?: string;
		initialVisibleCount: number | undefined;
		loadMoreIncrement?: number;
		headerIcon?: Snippet;
		itemRenderer: Snippet<
			[{ item: unknown; index: number; observerRoot: HTMLElement | null }]
		>;
	}

	let { items, itemRenderer, className = "" }: Props = $props();
</script>

<div class="cosense-card-links__section {className}">
	{#each items as item, index}
		{@render itemRenderer({ item, index, observerRoot: null })}
	{/each}
</div>
