<script lang="ts">
	import { svgAttrs, ICON_PATHS } from "ui/utils/icons";
	import ClickableHeader from "ui/components/common/ClickableHeader.svelte";
	import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
	import type { TwoHopVirtualListSection } from "./twoHopVirtualListModel";

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
	}

	let { kind, title, count, sectionId, header }: Props = $props();

	const iconPath = $derived(
		kind === "tag-section" ? ICON_PATHS.Tag : ICON_PATHS.Link,
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
>
	{#snippet icon()}
		<svg
			{...svgAttrs}
			width="26"
			height="26"
			stroke="currentColor"
			class="twohop-links-icon"
		>
			{@html iconPath}
		</svg>
	{/snippet}
</ClickableHeader>
