<script lang="ts">
	import type { ItemProps } from "./types";
	import { useLinkContext } from "ui/context/linkContext";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import CardPreview from "features/preview/ui/CardPreview.svelte";
	import PreviewHost from "features/preview/ui/PreviewHost.svelte";
	import UnresolvedPreviewPlaceholder from "features/preview/ui/UnresolvedPreviewPlaceholder.svelte";
	import { ARIA_LABELS, DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";
	import { formatLinkText } from "features/preview/text-processing/textUtils";
	import { getItemStrategy } from "application/presenters";
	import { getPriorityFrontmatterCardTitle } from "core/frontmatterCardTitle";
	import { createItemInteractionKey } from "ui/interactions/interactionTypes";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";

	let {
		item,
		settings,
		searchQuery = "",
		searchScope = "title-and-content",
		draggable = true,
		previewRefreshToken = 0,
		contentPreview = undefined,
		interactionId: providedInteractionId = undefined,
		interactionKey: providedInteractionKey = undefined,
		previewSlotId = undefined,
		presentation = undefined,
		model = undefined,
	}: ItemProps = $props();

	const context = useLinkContext();

	const renderItem = $derived(model?.item ?? item);
	const renderSearchQuery = $derived(model?.searchQuery ?? searchQuery);
	const renderPresentation = $derived(model?.presentation ?? presentation);
	const strategy = $derived(
		model ? null : renderItem ? getItemStrategy(renderItem) : null,
	);

	// 各プロパティをStrategyを通じて算出
	const targetFile = $derived(
		model
			? model.targetFile
			: renderItem
				? (strategy?.getTargetFile(renderItem.data, context) ?? null)
				: null,
	);
	const className = $derived(
		model
			? model.className
			: renderItem
				? (strategy?.getClassName(renderItem.data) ?? null)
				: null,
	);

	const title = $derived.by(() => {
		if (model) return model.title;
		if (!renderItem) {
			return "";
		}

		if (targetFile) {
			return (
				getPriorityFrontmatterCardTitle(
					targetFile,
					settings.priorityFrontmatterKeyForTitle,
					context.getMetadata,
				) ?? context.fileToLinktext(targetFile, context.sourceFile.path, true)
			);
		}

		switch (renderItem.type) {
			case "branch":
				return formatLinkText(renderItem.data.hop1);
			case "backlink":
				return formatLinkText(renderItem.data);
			case "taggedNote":
				return renderItem.data.file.basename;
			case "file":
				return renderItem.data.basename;
			case "newLink":
				return formatLinkText(renderItem.data);
			default:
				return "";
		}
	});
	const ariaLabel = $derived(
		model
			? model.ariaLabel
			: renderItem?.type === "newLink"
				? ARIA_LABELS.UNRESOLVED_LINK
				: ARIA_LABELS.OPEN_LINK(title),
	);

	const extension = $derived(
		model ? model.extension : (targetFile?.extension ?? null),
	);
	const directory = $derived(
		model ? model.directory : (targetFile?.parent?.path ?? null),
	);
	const interactionKey = $derived(
		model
			? model.interactionKey
			: renderItem
				? (providedInteractionKey ?? createItemInteractionKey(renderItem))
				: undefined,
	);
	const interactionId = $derived.by(() => {
		if (model) return model.interactionId;
		return providedInteractionId ?? interactionKey;
	});
	const activePreviewSnapshot = $derived.by(() => {
		const previewSnapshot = model?.previewSnapshot ?? undefined;
		if (!targetFile || !previewSnapshot) return undefined;
		if (previewSnapshot.file.path !== targetFile.path) return undefined;

		const expectedIdentity = model?.previewActivationIdentity;
		if (expectedIdentity && previewSnapshot.identity !== expectedIdentity) {
			return undefined;
		}

		return previewSnapshot;
	});
	const componentReevaluationProbe = $derived.by(() => {
		if (process.env.NODE_ENV === "production") return "";

		void item;
		void settings;
		void searchQuery;
		void searchScope;
		void draggable;
		void previewRefreshToken;
		void contentPreview;
		void providedInteractionId;
		void providedInteractionKey;
		void previewSlotId;
		void presentation;
		void model;
		void renderItem;
		void renderSearchQuery;
		void renderPresentation;
		void strategy;
		void targetFile;
		void className;
		void title;
		void ariaLabel;
		void extension;
		void directory;
		void interactionKey;
		void interactionId;
		void activePreviewSnapshot;
		return markCCLComponentReevaluation("ViewItemCard");
	});
</script>

{componentReevaluationProbe}
{#if renderItem && interactionId}
	<LinkItem
		{title}
		{ariaLabel}
		file={targetFile}
		extension={extension ?? undefined}
		{interactionId}
		interactionKind="item"
		{draggable}
		className={className ?? undefined}
		{directory}
		{settings}
		searchQuery={renderSearchQuery}
		presentation={renderPresentation}
	>
		{#snippet children()}
			{#if !DEBUG_DISABLE_CARD_DOM_PREVIEW && renderItem.type === "newLink" && !targetFile}
				<UnresolvedPreviewPlaceholder />
			{:else if !DEBUG_DISABLE_CARD_DOM_PREVIEW && targetFile && previewSlotId}
				<PreviewHost slotId={previewSlotId} />
			{:else if !DEBUG_DISABLE_CARD_DOM_PREVIEW && targetFile}
				<CardPreview
					bindingIdentity={model?.previewActivationIdentity ?? ""}
					renderSnapshot={activePreviewSnapshot}
					file={model ? undefined : targetFile}
					searchQuery={renderSearchQuery}
					{previewRefreshToken}
					previewOverride={model?.previewOverride ?? null}
					getPreview={context.getPreview}
				/>
			{/if}
		{/snippet}
	</LinkItem>
{/if}
