<script lang="ts">
	import type { ItemProps } from "./types";
	import { useLinkContext } from "ui/context/linkContext";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import CardPreview from "features/preview/ui/CardPreview.svelte";
	import PreviewHost from "features/preview/ui/PreviewHost.svelte";
	import UnresolvedPreviewPlaceholder from "features/preview/ui/UnresolvedPreviewPlaceholder.svelte";
	import { ARIA_LABELS, getDebugDisableCardDomPreview } from "../../../appConstants";
	import { formatLinkText } from "features/preview/text-processing/textUtils";
	import { getItemStrategy } from "application/presenters";
	import { getPriorityFrontmatterCardTitle } from "core/frontmatterCardTitle";
	import { createItemInteractionKey } from "ui/interactions/interactionTypes";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";
	import type { TFile } from "obsidian";
	import type { ViewItem } from "application/presenters";
	import type { CardPresentationState } from "ui/components/common/cardPresentation";
	import type { PreviewData } from "features/preview/public-types";
	import type { CardPreviewSnapshot } from "features/preview/ui/cardPreviewSnapshot";
	import type { CardRenderModel } from "./cardRenderModel";

	interface LegacyViewItemCardRenderState {
		readonly item: ViewItem;
		readonly targetFile: TFile | null;
		readonly title: string;
		readonly ariaLabel: string;
		readonly className: string | null;
		readonly extension: string | null;
		readonly directory: string | null;
		readonly interactionId: string;
		readonly searchQuery: string;
		readonly presentation: CardPresentationState | undefined;
		readonly previewActivationIdentity: string;
		readonly previewOverride: PreviewData | null;
		readonly previewSnapshot: CardPreviewSnapshot | undefined;
		readonly previewFile: TFile | undefined;
	}

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

	const legacyRenderState = $derived.by((): LegacyViewItemCardRenderState | null => {
		if (model || !item) return null;
		return buildLegacyViewItemCardState(item);
	});
	const renderState = $derived<
		CardRenderModel | LegacyViewItemCardRenderState | null
	>(model ?? legacyRenderState);
	const activePreviewSnapshot = $derived.by(() => {
		if (!model) return legacyRenderState?.previewSnapshot;
		return resolveActivePreviewSnapshot(
			model.targetFile,
			model.previewActivationIdentity,
			model.previewSnapshot,
		);
	});
	const previewFile = $derived(model ? undefined : legacyRenderState?.previewFile);

	function buildLegacyViewItemCardState(
		renderItem: ViewItem,
	): LegacyViewItemCardRenderState {
		const strategy = getItemStrategy(renderItem);
		const targetFile = strategy?.getTargetFile(renderItem.data, context) ?? null;
		const className = strategy?.getClassName(renderItem.data) ?? null;
		const title = resolveLegacyTitle(renderItem, targetFile);
		const interactionKey =
			providedInteractionKey ?? createItemInteractionKey(renderItem);

		return {
			item: renderItem,
			targetFile,
			title,
			ariaLabel:
				renderItem.type === "newLink"
					? ARIA_LABELS.UNRESOLVED_LINK
					: ARIA_LABELS.OPEN_LINK(title),
			className,
			extension: targetFile?.extension ?? null,
			directory: targetFile?.parent?.path ?? null,
			interactionId: providedInteractionId ?? interactionKey,
			searchQuery,
			presentation,
			previewActivationIdentity: "",
			previewOverride: null,
			previewSnapshot: undefined,
			previewFile: targetFile ?? undefined,
		};
	}

	function resolveLegacyTitle(
		renderItem: ViewItem,
		targetFile: TFile | null,
	): string {
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
	}

	function resolveActivePreviewSnapshot(
		targetFile: TFile | null,
		expectedIdentity: string | undefined,
		previewSnapshot: CardPreviewSnapshot | null,
	): CardPreviewSnapshot | undefined {
		if (!targetFile || !previewSnapshot) return undefined;
		if (previewSnapshot.file.path !== targetFile.path) return undefined;
		if (expectedIdentity && previewSnapshot.identity !== expectedIdentity) {
			return undefined;
		}

		return previewSnapshot;
	}

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
		void legacyRenderState;
		void renderState;
		void activePreviewSnapshot;
		void previewFile;
		return markCCLComponentReevaluation("ViewItemCard");
	});
</script>

{componentReevaluationProbe}
{#if renderState}
	<LinkItem
		title={renderState.title}
		ariaLabel={renderState.ariaLabel}
		file={renderState.targetFile}
		extension={renderState.extension ?? undefined}
		interactionId={renderState.interactionId}
		interactionKind="item"
		{draggable}
		className={renderState.className ?? undefined}
		directory={renderState.directory}
		{settings}
		searchQuery={renderState.searchQuery}
		presentation={renderState.presentation}
	>
		{#snippet children()}
			{#if !getDebugDisableCardDomPreview() && renderState.item.type === "newLink" && !renderState.targetFile}
				<UnresolvedPreviewPlaceholder />
			{:else if !getDebugDisableCardDomPreview() && renderState.targetFile && previewSlotId}
				<PreviewHost slotId={previewSlotId} />
			{:else if !getDebugDisableCardDomPreview() && renderState.targetFile}
				<CardPreview
					bindingIdentity={renderState.previewActivationIdentity ?? ""}
					renderSnapshot={activePreviewSnapshot}
					file={previewFile}
					searchQuery={renderState.searchQuery}
					{previewRefreshToken}
					previewOverride={renderState.previewOverride}
					getPreview={context.getPreview}
				/>
			{/if}
		{/snippet}
	</LinkItem>
{/if}
