<script lang="ts">
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import ClickableHeader from "ui/components/common/ClickableHeader.svelte";
	import Icon from "ui/components/common/Icon.svelte";
	import VirtualListLoadMoreButton from "ui/virtualization/components/VirtualListLoadMoreButton.svelte";
	import type { IconName } from "ui/shared/icons/iconRegistry";
	import type { TwoHopMountedCell } from "features/two-hop/ui/twoHopMountedRows";
	import {
		resolveTwoHopItemStaticState,
		resolveTwoHopSectionVariant,
	} from "features/two-hop/ui/twoHopCellStaticState";

	interface Props {
		mountedCell: TwoHopMountedCell;
		applicationStore?: ApplicationStore;
		cardModel?: CardRenderModel;
		onLoadMore: (sectionId: string) => void;
		previewSlotId: string;
	}

	let {
		mountedCell,
		applicationStore,
		cardModel = undefined,
		onLoadMore,
		previewSlotId,
	}: Props = $props();

	const itemPresentation = $derived.by(() => {
		if (mountedCell.cell.kind !== "item") return null;
		if (cardModel?.presentation) return cardModel.presentation;
		return resolveTwoHopItemStaticState(
			mountedCell.cell.item,
			mountedCell.section.header.section,
		).presentation;
	});
	const resolveHeaderIcon = (): IconName => {
		switch (mountedCell.section.header.section.kind) {
			case "new-links-section":
				return "Unlink";
			case "tag-section":
				return "Tag";
			case "primary-section":
			case "two-hop-branch":
				return "Link";
		}
	};
</script>

{#if mountedCell.cell.kind === "header"}
	{@const section = mountedCell.section}
	{@const headerProps = section.header.props}
	{@const sectionVariant = resolveTwoHopSectionVariant(section.header.section)}
	{#if headerProps.interactionId}
		<ClickableHeader
			title={section.header.section.title}
			count={section.totalItemCount}
			className={headerProps.className}
			draggable={headerProps.draggable}
			directory={headerProps.directory}
			settings={headerProps.settings}
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
{:else if mountedCell.cell.kind === "load-more"}
	<VirtualListLoadMoreButton onClick={() => onLoadMore(mountedCell.section.key)} />
{:else if applicationStore && cardModel}
	<ViewItemCard
		item={mountedCell.cell.item.item}
		settings={applicationStore.settings}
		model={cardModel}
		{previewSlotId}
	/>
{:else}
	<div
		class="cosense-card-links__box"
		data-ccl-section-variant={itemPresentation?.sectionVariant}
		data-ccl-resolution={itemPresentation?.resolution}
	>
		<div class="cosense-card-links__box-title-wrapper">
			<div class="cosense-card-links__box-title">
				{mountedCell.cell.item.virtualKey}
			</div>
		</div>
	</div>
{/if}
