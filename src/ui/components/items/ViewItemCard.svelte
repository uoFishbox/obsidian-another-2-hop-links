<script lang="ts">
	import type { ItemProps } from "./types";
	import { useAppContext, useLinkContext } from "ui/context/linkContext";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import CardPreviewGate from "./CardPreviewGate.svelte";
	import UnresolvedPreviewPlaceholder from "./UnresolvedPreviewPlaceholder.svelte";
	import {
		ARIA_LABELS,
		DEBUG_DISABLE_CARD_DOM_PREVIEW,
		IS_PROD,
	} from "../../../appConstants";
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
	}: ItemProps = $props();

	const context = useLinkContext();
	const { applicationStore } = useAppContext();
	const interactionRegistry = useInteractionRegistry();

	const strategy = $derived(item ? getItemStrategy(item) : null);

	// 各プロパティをStrategyを通じて算出
	const targetFile = $derived(
		item ? (strategy?.getTargetFile(item.data, context) ?? null) : null,
	);
	const className = $derived(
		item ? (strategy?.getClassName(item.data) ?? null) : null,
	);

	const title = $derived.by(() => {
		if (!item) {
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

		switch (item.type) {
			case "branch":
				return formatLinkText(item.data.hop1);
			case "backlink":
				return formatLinkText(item.data);
			case "taggedNote":
				return item.data.file.basename;
			case "file":
				return item.data.basename;
			case "newLink":
				return formatLinkText(item.data);
			default:
				return "";
		}
	});
	const ariaLabel = $derived.by(() =>
		item?.type === "newLink"
			? ARIA_LABELS.UNRESOLVED_LINK
			: ARIA_LABELS.OPEN_LINK(title),
	);

	const extension = $derived(targetFile?.extension ?? null);
	const directory = $derived(targetFile?.parent?.path ?? null);
	const interactionKey = $derived(
		item ? (providedInteractionKey ?? createItemInteractionKey(item)) : undefined,
	);
	const interactionId = $derived.by(() => {
		if (!interactionKey) return providedInteractionId;
		return (
			providedInteractionId ??
			interactionRegistry?.createInteractionToken(interactionKey) ??
			interactionKey
		);
	});
	const interactionDescriptor = $derived.by((): ItemInteractionDescriptor | null =>
		item && interactionId && interactionKey
			? createItemInteractionDescriptor(item, settings, searchQuery, context, {
					interactionId,
					interactionKey,
				})
			: null,
	);
	const previewGateRowProps = $derived.by(() =>
		rowIndex !== undefined && activationCandidateId !== undefined
			? { rowIndex, activationCandidateId }
			: null,
	);
	const componentReevaluationProbe = $derived.by(() => {
		if (IS_PROD) return "";

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
{#if item && interactionId}
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
		{searchQuery}
	>
		{#snippet children()}
			{#if !DEBUG_DISABLE_CARD_DOM_PREVIEW && item.type === "newLink" && !targetFile}
				<UnresolvedPreviewPlaceholder />
			{:else if !DEBUG_DISABLE_CARD_DOM_PREVIEW && previewGateRowProps}
				<CardPreviewGate
					file={targetFile}
					getPreview={context.getPreview}
					{applicationStore}
					{searchQuery}
					{searchScope}
					{previewRefreshToken}
					{contentPreview}
					rowIndex={previewGateRowProps.rowIndex}
					activationCandidateId={previewGateRowProps.activationCandidateId}
				/>
			{/if}
		{/snippet}
	</LinkItem>
{/if}
