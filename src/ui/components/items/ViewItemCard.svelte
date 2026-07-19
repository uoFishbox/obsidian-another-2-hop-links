<script lang="ts">
	import type { ItemProps } from "./types";
	import { useAppContext, useLinkContext } from "ui/context/linkContext";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import CardPreviewGate from "features/preview/ui/CardPreviewGate.svelte";
	import UnresolvedPreviewPlaceholder from "features/preview/ui/UnresolvedPreviewPlaceholder.svelte";
	import { ARIA_LABELS, DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";
	import { formatLinkText } from "features/preview/text-processing/textUtils";
	import { getItemStrategy } from "application/presenters";
	import { getPriorityFrontmatterCardTitle } from "core/frontmatterCardTitle";
	import {
		createItemInteractionDescriptor,
		createItemInteractionKey,
		type ItemInteractionDescriptor,
	} from "ui/interactions/interactionTypes";
	import { useInteractionRegistry } from "ui/interactions/interactionRegistry";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";

	let {
		item,
		settings,
		searchQuery = "",
		searchScope = "title-and-content",
		draggable = true,
		previewRefreshToken = 0,
		contentPreview = undefined,
		interactionRegistration = "self",
		interactionId: providedInteractionId = undefined,
		interactionKey: providedInteractionKey = undefined,
		rowIndex = undefined,
		activationCandidateId = undefined,
		presentation = undefined,
		model = undefined,
	}: ItemProps = $props();

	const context = useLinkContext();
	const { applicationStore } = useAppContext();
	const interactionRegistry = useInteractionRegistry();

	const renderItem = $derived(model?.item ?? item);
	const renderSearchQuery = $derived(model?.searchQuery ?? searchQuery);
	const renderSearchScope = $derived(model?.searchScope ?? searchScope);
	const renderContentPreview = $derived(model?.contentPreview ?? contentPreview);
	const renderPreviewRefreshToken = $derived(
		model?.previewRefreshToken ?? previewRefreshToken,
	);
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
		if (!interactionKey) return providedInteractionId;
		return (
			providedInteractionId ??
			interactionRegistry?.createInteractionToken(interactionKey) ??
			interactionKey
		);
	});
	const interactionDescriptor = $derived.by((): ItemInteractionDescriptor | null =>
		interactionRegistration === "self" &&
		renderItem &&
		interactionId &&
		interactionKey
			? createItemInteractionDescriptor(
					renderItem,
					settings,
					renderSearchQuery,
					context,
					{
						interactionId,
						interactionKey,
					},
				)
			: null,
	);
	const previewGateRowProps = $derived.by(() =>
		rowIndex !== undefined && activationCandidateId !== undefined
			? { rowIndex, activationCandidateId }
			: null,
	);
	const componentReevaluationProbe = $derived.by(() => {
		if (process.env.NODE_ENV === "production") return "";

		void item;
		void settings;
		void searchQuery;
		void searchScope;
		void draggable;
		void previewRefreshToken;
		void contentPreview;
		void interactionRegistration;
		void providedInteractionId;
		void providedInteractionKey;
		void rowIndex;
		void activationCandidateId;
		void presentation;
		void model;
		void renderItem;
		void renderSearchQuery;
		void renderSearchScope;
		void renderContentPreview;
		void renderPreviewRefreshToken;
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
		void interactionDescriptor;
		void previewGateRowProps;
		return markCCLComponentReevaluation("ViewItemCard");
	});

	function registerInteractionDescriptor(): (() => void) | undefined {
		if (
			interactionRegistration !== "self" ||
			!interactionRegistry ||
			!interactionDescriptor
		) {
			return;
		}

		interactionRegistry.register(interactionDescriptor);
		return () => {
			interactionRegistry.unregister(interactionDescriptor.interactionId);
		};
	}

	$effect(() => {
		return registerInteractionDescriptor();
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
			{:else if !DEBUG_DISABLE_CARD_DOM_PREVIEW && previewGateRowProps}
				<CardPreviewGate
					file={targetFile}
					getPreview={context.getPreview}
					getVisiblePreviewQueueSize={context.getVisiblePreviewQueueSize}
					getActiveVisiblePreviewCount={context.getActiveVisiblePreviewCount}
					{applicationStore}
					searchQuery={renderSearchQuery}
					searchScope={renderSearchScope}
					previewRefreshToken={renderPreviewRefreshToken}
					contentPreview={renderContentPreview}
					precomputedPreviewIdentity={model?.previewActivationIdentity}
					rowIndex={previewGateRowProps.rowIndex}
					activationCandidateId={previewGateRowProps.activationCandidateId}
				/>
			{/if}
		{/snippet}
	</LinkItem>
{/if}
