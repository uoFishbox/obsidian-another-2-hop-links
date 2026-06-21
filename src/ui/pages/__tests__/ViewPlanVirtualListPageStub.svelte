<script lang="ts">
	import type { Snippet } from "svelte";
	import type { SectionRenderDescriptor } from "ui/components/sections/types";
	import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";

	interface Props {
		sections: SectionRenderDescriptor<unknown, unknown>[];
		className?: string;
		renderHeader?: Snippet<
			[
				{
					section: unknown;
					title: string;
					totalCount: number;
					sectionId: string;
					headerProps: SectionRenderDescriptor<
						unknown,
						unknown
					>["headerProps"];
				},
			]
		>;
		renderItem: Snippet<
			[
				{
					item: unknown;
					section: unknown;
					index: number;
					observerRoot: HTMLElement | null;
					visibility: VirtualizedItemVisibility;
				},
			]
		>;
	}

	let { sections, className = "", renderHeader, renderItem }: Props = $props();
</script>

<div class={`view-plan-virtual-list ${className}`.trim()}>
	{#each sections as descriptor}
		<section data-section-id={descriptor.sectionId}>
			{#if renderHeader}
				{@render renderHeader({
					section: descriptor.section,
					title: descriptor.title,
					totalCount: descriptor.totalCount,
					sectionId: descriptor.sectionId,
					headerProps: descriptor.headerProps,
				})}
			{/if}
			{#each descriptor.getItems() as item, index}
				{@render renderItem({
					item,
					section: descriptor.section,
					index,
					observerRoot: null,
					visibility: "visible",
				})}
			{/each}
		</section>
	{/each}
</div>
