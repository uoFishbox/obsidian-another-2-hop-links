<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import ClickableHeader from "ui/components/common/ClickableHeader.svelte";
	import Icon from "ui/components/common/Icon.svelte";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import VirtualListLoadMoreButton from "ui/virtualization/components/VirtualListLoadMoreButton.svelte";
	import UnresolvedPreviewPlaceholder from "features/card-preview/ui/UnresolvedPreviewPlaceholder.svelte";
	import { previewHost } from "features/card-preview/ui/previewHostAction";
	import type { CardShellModel } from "ui/components/items/cardRenderModel";
	import type { IconName } from "ui/shared/icons/iconRegistry";
	import type { TwoHopVirtualCell } from "features/two-hop/ui/twoHopRowModel";
	import { resolveTwoHopSectionVariant } from "features/two-hop/ui/twoHopCellStaticState";
	import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
	import { getDebugDisableCardDomPreview } from "../../../appConstants";

	interface Props {
		cell: TwoHopVirtualCell;
		previewHostEnabled: boolean;
		previewSlotId: string;
		registerCardModelConsumer: (
			logicalKey: string,
			consumer: (model: CardShellModel | undefined) => void,
		) => () => void;
		onLoadMore: (sectionId: string) => void;
	}

	let {
		cell,
		previewHostEnabled,
		previewSlotId,
		registerCardModelConsumer,
		onLoadMore,
	}: Props = $props();
	let cardModel = $state.raw<CardShellModel | undefined>(undefined);
	let boundLogicalKey = cell.logicalKey;

	onMount(() => {
		recordCCLDevMeasurement("twoHop.cellBody.mount");
	});

	onDestroy(() => {
		recordCCLDevMeasurement("twoHop.cellBody.unmount");
	});

	$effect(() => {
		const nextLogicalKey = cell.logicalKey;
		if (nextLogicalKey !== boundLogicalKey) {
			boundLogicalKey = nextLogicalKey;
			recordCCLDevMeasurement("twoHop.cellBody.rebind");
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
</script>

{#if cell.kind === "header"}
	{@const section = cell.section}
	{@const headerProps = section.header.props}
	{@const sectionVariant = resolveTwoHopSectionVariant(section)}
	{#if headerProps.interactionId}
		<ClickableHeader
			title={section.title}
			count={section.totalCount}
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
	<VirtualListLoadMoreButton onClick={() => onLoadMore(cell.section.id)} />
{:else}
	{@const model = cardModel}
	<LinkItem
		title={model?.title ?? ""}
		ariaLabel={model?.ariaLabel ?? ""}
		file={model?.targetFile ?? null}
		extension={model?.extension ?? undefined}
		interactionId={model?.interactionId ?? cell.logicalKey}
		interactionKind="item"
		interactive={Boolean(model)}
		draggable={Boolean(model)}
		className={model
			? (model.className ?? undefined)
			: "twohop-card-shell is-skeleton"}
		directory={model?.directory ?? null}
		searchQuery={model?.searchQuery ?? ""}
		presentation={model?.presentation}
	>
		{#snippet children()}
			{#if model && !getDebugDisableCardDomPreview() && model.item.type === "newLink" && !model.targetFile}
				<UnresolvedPreviewPlaceholder />
			{:else if model && !getDebugDisableCardDomPreview() && model.targetFile && previewHostEnabled}
				<div
					use:previewHost={previewSlotId}
					class="cosense-card-links__box-preview"
					data-preview-owner="virtual-surface"
				></div>
			{/if}
		{/snippet}
	</LinkItem>
{/if}
