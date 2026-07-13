<script lang="ts">
	import Icon from "ui/components/common/Icon.svelte";
	import LinkSectionHeader from "ui/components/common/LinkSectionHeader.svelte";
	import TwoHopSectionHeader from "./TwoHopSectionHeader.svelte";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualListSection,
	} from "./twoHopVirtualListModel";
	import type { SectionRenderDescriptor } from "ui/components/sections/types";
	import { resolveTwoHopSectionVariant } from "./twoHopCellBinding";

	interface Props {
		section: TwoHopVirtualListSection;
		title: string;
		totalCount: number;
		sectionId: string;
		headerProps: SectionRenderDescriptor<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		>["headerProps"];
	}

	let { section, title, totalCount, sectionId, headerProps }: Props = $props();
	const sectionVariant = $derived(resolveTwoHopSectionVariant(section));
</script>

{#if section.kind === "primary-section"}
	<LinkSectionHeader {title} {totalCount} {sectionVariant} />
{:else if section.kind === "new-links-section"}
	<LinkSectionHeader {title} {totalCount} {sectionVariant}>
		{#snippet icon()}
			<Icon name="Unlink" width={26} height={26} class="twohop-links-icon" />
		{/snippet}
	</LinkSectionHeader>
{:else if section.kind === "two-hop-branch" || section.kind === "tag-section"}
	<TwoHopSectionHeader
		kind={section.kind}
		title={section.title}
		count={totalCount}
		{sectionId}
		header={headerProps}
		{sectionVariant}
	/>
{/if}
