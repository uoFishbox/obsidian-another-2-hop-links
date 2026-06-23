<script lang="ts">
	import type { ItemProps } from "./types";
	import { useLinkContext } from "ui/context/linkContext";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import ViewItemCardPreview from "./ViewItemCardPreview.svelte";
	import { ARIA_LABELS } from "../../../appConstants";
	import { formatLinkText } from "features/preview/text-processing/textUtils";
	import { getItemStrategy } from "application/presenters";
	import { getFileCardDisplayTitle } from "core/frontmatterCardTitle";
	import {
		createItemInteractionDescriptor,
		createItemInteractionKey,
		type ItemInteractionDescriptor,
	} from "ui/interactions/interactionTypes";
	import { useInteractionRegistry } from "ui/interactions/interactionRegistry";

	let {
		item,
		settings,
		searchQuery = "",
		searchScope = "title-and-content",
		observerRoot = undefined,
		previewVisibilityMode = undefined,
		draggable = true,
		previewRefreshToken = 0,
		contentPreview = undefined,
		interactionRegistration = "self",
		interactionId: providedInteractionId = undefined,
		interactionKey: providedInteractionKey = undefined,
	}: ItemProps = $props();

	const context = useLinkContext();
	const interactionRegistry = useInteractionRegistry();

	// Strategyパターンを使用してアイテムタイプに応じた処理を取得
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
			return getFileCardDisplayTitle(targetFile, {
				sourcePath: context.sourceFile.path,
				fileToLinktext: context.fileToLinktext,
				getMetadata: context.getMetadata,
				priorityFrontmatterKeyForTitle: settings.priorityFrontmatterKeyForTitle,
			});
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
			<ViewItemCardPreview
				file={targetFile}
				isUnresolvedNewLink={item.type === "newLink"}
				{searchQuery}
				{searchScope}
				{observerRoot}
				{previewVisibilityMode}
				{previewRefreshToken}
				{contentPreview}
			/>
		{/snippet}
	</LinkItem>
{/if}
