<script lang="ts">
	import ClickableHeader from "ui/components/common/ClickableHeader.svelte";
	import Icon from "ui/components/common/Icon.svelte";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import VirtualListLoadMoreButton from "ui/virtualization/components/VirtualListLoadMoreButton.svelte";
	import PreviewHost from "features/preview/ui/PreviewHost.svelte";
	import UnresolvedPreviewPlaceholder from "features/preview/ui/UnresolvedPreviewPlaceholder.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { IconName } from "ui/shared/icons/iconRegistry";
	import type { TwoHopProgressiveCell } from "features/two-hop/ui/twoHopProgressivePlan";
	import { resolveTwoHopSectionVariant } from "features/two-hop/ui/twoHopCellStaticState";
	import { resolveProgressivePreviewSlotId } from "features/two-hop/ui/useTwoHopProgressiveList.svelte";
	import { getDebugDisableCardDomPreview } from "../../../appConstants";

	interface Props {
		cell: TwoHopProgressiveCell;
		previewCandidate: boolean;
		registerCardModelConsumer: (
			logicalKey: string,
			consumer: (model: CardRenderModel | undefined) => void,
		) => () => void;
		onLoadMore: (sectionId: string) => void;
	}

	let { cell, previewCandidate, registerCardModelConsumer, onLoadMore }: Props =
		$props();
	let cardModel = $state.raw<CardRenderModel | undefined>(undefined);

	$effect(() => {
		if (cell.kind !== "item") {
			cardModel = undefined;
			return;
		}
		return registerCardModelConsumer(cell.logicalKey, (nextModel) => {
			cardModel = nextModel;
		});
	});

	function resolveHeaderIcon(): IconName {
		switch (cell.section.header.section.kind) {
			case "new-links-section":
				return "Unlink";
			case "tag-section":
				return "Tag";
			case "primary-section":
			case "two-hop-branch":
				return "Link";
		}
	}
</script>

{#if cell.kind === "header"}
	{@const section = cell.section}
	{@const headerProps = section.header.props}
	{@const sectionVariant = resolveTwoHopSectionVariant(section.header.section)}
	{#if headerProps.interactionId}
		<ClickableHeader
			title={section.header.section.title}
			count={section.totalItemCount}
			className={headerProps.className}
			draggable={headerProps.draggable}
			directory={headerProps.directory}
			interactionId={headerProps.interactionId}
			interactionKind="sectionHeader"
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
		</ClickableHeader>
	{:else}
		<div
			class="cosense-card-links__box cosense-card-links__connected-links-header {headerProps.className ??
				''}"
			aria-label={`${section.totalItemCount} notes`}
			data-ccl-section-variant={sectionVariant}
		>
			<div class="cosense-card-links__title-container">
				<span class="cosense-card-links__header-title">
					{section.header.section.title}
				</span>
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
	<VirtualListLoadMoreButton onClick={() => onLoadMore(cell.section.key)} />
{:else if cardModel}
	{@const model = cardModel}
	<LinkItem
		title={model.title}
		ariaLabel={model.ariaLabel}
		file={model.targetFile}
		extension={model.extension ?? undefined}
		interactionId={model.interactionId}
		interactionKind="item"
		draggable={true}
		className={model.className ?? undefined}
		directory={model.directory}
		searchQuery={model.searchQuery}
		presentation={model.presentation}
	>
		{#snippet children()}
			{#if !getDebugDisableCardDomPreview() && model.item.type === "newLink" && !model.targetFile}
				<UnresolvedPreviewPlaceholder />
			{:else if !getDebugDisableCardDomPreview() && model.targetFile && previewCandidate}
				<PreviewHost
					slotId={resolveProgressivePreviewSlotId(cell.logicalKey)}
				/>
			{/if}
		{/snippet}
	</LinkItem>
{:else}
	<div
		class="cosense-card-links__box twohop-card-shell is-skeleton"
		aria-hidden="true"
	>
		<div class="cosense-card-links__box-title-wrapper"></div>
	</div>
{/if}
