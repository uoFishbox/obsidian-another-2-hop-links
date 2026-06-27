<script lang="ts">
	import { svgAttrs, ICON_PATHS } from "ui/utils/icons";
	import LinkSectionHeader from "ui/components/common/LinkSectionHeader.svelte";
	import TwoHopSectionHeader from "./TwoHopSectionHeader.svelte";
	import type {
		TwoHopPageVirtualItem,
		TwoHopPageVirtualSection,
	} from "./twohopPageVirtualModel";
	import type { SectionRenderDescriptor } from "ui/components/sections/types";

	interface Props {
		section: TwoHopPageVirtualSection;
		title: string;
		totalCount: number;
		sectionId: string;
		headerProps: SectionRenderDescriptor<
			TwoHopPageVirtualItem,
			TwoHopPageVirtualSection
		>["headerProps"];
	}

	let { section, title, totalCount, sectionId, headerProps }: Props = $props();
</script>

{#if section.kind === "primary-section"}
	<LinkSectionHeader {title} {totalCount} />
{:else if section.kind === "new-links-section"}
	<LinkSectionHeader {title} {totalCount}>
		{#snippet icon()}
			<svg
				{...svgAttrs}
				width="26"
				height="26"
				stroke="currentColor"
				class="twohop-links-icon"
			>
				{@html ICON_PATHS.Unlink}
			</svg>
		{/snippet}
	</LinkSectionHeader>
{:else if section.kind === "two-hop-branch" || section.kind === "tag-section"}
	<TwoHopSectionHeader
		kind={section.kind}
		title={section.title}
		count={totalCount}
		{sectionId}
		header={headerProps}
	/>
{/if}
