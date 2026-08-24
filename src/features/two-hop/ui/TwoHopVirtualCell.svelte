<script lang="ts">
	import InteractiveSectionHeader from "presentation/obsidian/interactions/InteractiveSectionHeader.svelte";
	import Icon from "ui/primitives/Icon.svelte";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import CardGridLoadMoreButton from "ui/card-grid/CardGridLoadMoreButton.svelte";
	import UnresolvedPreviewPlaceholder from "features/card-preview/ui/UnresolvedPreviewPlaceholder.svelte";
	import { previewHost } from "features/card-preview/ui/previewHostAction";
	import type { CardSectionVariant } from "ui/components/common/cardPresentation";
	import type { CardShellModel } from "ui/components/items/cardRenderModel";
	import type { IconName } from "ui/shared/icons/iconRegistry";
	import type { TwoHopVirtualCell } from "features/two-hop/runtime/virtual-grid/rowModel";
	import type { TwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";

	interface Props {
		cell: TwoHopVirtualCell;
		previewHostEnabled: boolean;
		previewKey: string;
		registerCardModelConsumer: (
			logicalKey: string,
			consumer: (model: CardShellModel | undefined) => void,
		) => () => void;
		onLoadMore: (sectionId: string) => void;
	}

	let {
		cell,
		previewHostEnabled,
		previewKey,
		registerCardModelConsumer,
		onLoadMore,
	}: Props = $props();
	let cardModel = $state.raw<CardShellModel | undefined>(undefined);
	let boundLogicalKey = cell.logicalKey;

	$effect(() => {
		const nextLogicalKey = cell.logicalKey;
		if (nextLogicalKey !== boundLogicalKey) {
			boundLogicalKey = nextLogicalKey;
			cardModel = undefined;
		}

		if (cell.kind !== "item") {
			cardModel = undefined;
			return;
		}
		return registerCardModelConsumer(nextLogicalKey, (nextModel) => {
			cardModel = nextModel;
		});
	});

	function resolveHeaderIcon(): IconName {
		switch (cell.section.kind) {
			case "new-links-section":
				return "Unlink";
			case "tag-section":
				return "Tag";
			case "primary-section":
			case "two-hop-branch":
				return "Link";
		}
	}

	function resolveTwoHopSectionVariant(
		section: TwoHopSectionModel,
	): CardSectionVariant {
		switch (section.kind) {
			case "new-links-section":
				return "new-links";
			case "tag-section":
				return "tag";
			case "two-hop-branch":
				return "two-hop";
			case "primary-section":
				switch (section.id) {
					case "outgoing":
						return "outgoing";
					case "merged":
						return "merged";
					default:
						return "backlinks";
				}
		}
	}
</script>

{#if cell.kind === "header"}
	{@const section = cell.section}
	{@const headerProps = section.header.props}
	{@const sectionVariant = resolveTwoHopSectionVariant(section)}
	{#if headerProps.interactionId}
		<InteractiveSectionHeader
			title={section.title}
			count={section.totalCount}
			className={headerProps.className}
			draggable={headerProps.draggable}
			interactionId={headerProps.interactionId}
			interactionDescriptor={headerProps.interactionDescriptor}
			onClick={headerProps.onClick}
			{sectionVariant}
		>
			{#snippet icon()}
				<Icon
					name={resolveHeaderIcon()}
					width={26}
					height={26}
					class="twohop-links-icon"
				/>
			{/snippet}
		</InteractiveSectionHeader>
	{:else}
		<div
			class="cosense-card-links__box cosense-card-links__connected-links-header {headerProps.className ??
				''}"
			aria-label={`${section.totalCount} notes`}
			data-ccl-section-variant={sectionVariant}
		>
			<div class="cosense-card-links__title-container">
				<span class="cosense-card-links__header-title">{section.title}</span>
				<Icon
					name={resolveHeaderIcon()}
					width={26}
					height={26}
					class="twohop-links-icon"
				/>
			</div>
		</div>
	{/if}
{:else if cell.kind === "load-more"}
	<CardGridLoadMoreButton onClick={() => onLoadMore(cell.section.id)} />
{:else}
	{@const model = cardModel}
	<LinkItem
		title={model?.title ?? ""}
		ariaLabel={model?.ariaLabel ?? ""}
		file={model?.targetFile ?? null}
		extension={model?.extension ?? undefined}
		interactionId={model?.interactionId ?? cell.logicalKey}
		interactive={Boolean(model)}
		draggable={Boolean(model)}
		className={model
			? (model.className ?? undefined)
			: "twohop-card-shell is-skeleton"}
		searchQuery={model?.searchQuery ?? ""}
	>
		{#snippet children()}
			{#if model && model.item.type === "newLink" && !model.targetFile}
				<UnresolvedPreviewPlaceholder />
			{:else if model && model.targetFile && previewHostEnabled}
				<div
					use:previewHost={previewKey}
					class="cosense-card-links__box-preview"
				></div>
			{/if}
		{/snippet}
	</LinkItem>
{/if}
