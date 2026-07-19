<script lang="ts">
	import type { Snippet } from "svelte";
	import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";

	interface Section {
		sectionId: string;
		className?: string;
		items: readonly unknown[];
	}

	interface Props {
		sections: readonly Section[];
		itemRenderer: Snippet<
			[
				{
					item: unknown;
					section: Section;
					index: number;
					observerRoot: HTMLElement | null;
					visibility: VirtualizedItemVisibility;
				},
			]
		>;
	}

	let { sections, itemRenderer }: Props = $props();
</script>

{#each sections as section}
	<div class="cosense-card-links__section {section.className ?? ''}">
		{#each section.items as item, index}
			{@render itemRenderer({
				item,
				section: section,
				index,
				observerRoot: null,
				visibility: "visible",
			})}
		{/each}
	</div>
{/each}
