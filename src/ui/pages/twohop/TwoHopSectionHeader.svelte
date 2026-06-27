<script lang="ts">
	import { svgAttrs, ICON_PATHS } from "ui/utils/icons";
	import ClickableHeader from "ui/components/common/ClickableHeader.svelte";
	import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
	import type { TwoHopPageVirtualSection } from "./twohopPageVirtualModel";

	type HeaderSection = Extract<
		TwoHopPageVirtualSection,
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
</script>

<ClickableHeader
	{title}
	{count}
	{...header}
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
