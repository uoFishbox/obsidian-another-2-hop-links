<script lang="ts">
	import Icon from "ui/components/common/Icon.svelte";
	import { type IconName } from "ui/utils/icons";
	import ClickableHeader from "ui/components/common/ClickableHeader.svelte";
	import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
	import type { TwoHopVirtualListSection } from "./twoHopVirtualListModel";
	import type { CardSectionVariant } from "ui/components/common/cardPresentation";

	type HeaderSection = Extract<
		TwoHopVirtualListSection,
		{ kind: "two-hop-branch" | "tag-section" }
	>;

	interface Props {
		kind: HeaderSection["kind"];
		title: string;
		count: number;
		sectionId: string;
		header: ClickableHeaderExtraProps;
		sectionVariant: CardSectionVariant;
	}

	let { kind, title, count, sectionId, header, sectionVariant }: Props = $props();

	const iconName = $derived(
		(kind === "tag-section" ? "Tag" : "Link") satisfies IconName,
	);
	const clickableHeaderProps = $derived.by(() => {
		const rest: ClickableHeaderExtraProps = { ...header };
		delete rest.interactionDescriptor;
		return rest;
	});
</script>

<ClickableHeader
	{title}
	{count}
	{...clickableHeaderProps}
	interactionId={header.interactionId ?? sectionId}
	interactionKind={header.interactionKind ?? "sectionHeader"}
	{sectionVariant}
>
	{#snippet icon()}
		<Icon name={iconName} width={26} height={26} class="twohop-links-icon" />
	{/snippet}
</ClickableHeader>
