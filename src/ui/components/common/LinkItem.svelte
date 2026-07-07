<script lang="ts">
	import type { PluginSettings } from "types/settings";
	import { type TFile } from "obsidian";
	import Icon from "ui/components/common/Icon.svelte";
	import { type IconName } from "ui/utils/icons";
	import {
		interactionIdBinding,
		type InteractionKind,
	} from "ui/interactions/interactionTypes";
	import { isAttachment } from "core/rules/fileRules";
	import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from "../../../appConstants";
	import { type Snippet } from "svelte";
	import { useAppContext } from "ui/context/linkContext";
	import { highlightTextForSearch } from "features/preview/text-processing/searchHighlighter";

	interface Props {
		title: string;
		ariaLabel: string;
		interactionId: string;
		interactionKind: InteractionKind;
		draggable?: boolean;
		children?: Snippet;
		className?: string;
		extension?: string;
		settings: PluginSettings;
		directory?: string | null;
		file?: TFile | null;
		searchQuery?: string;
	}

	let {
		title,
		ariaLabel,
		interactionId,
		interactionKind,
		draggable = true,
		children,
		className = "",
		extension,
		settings,
		directory = null,
		file = null,
		searchQuery = "",
	}: Props = $props();

	let appContext: ReturnType<typeof useAppContext> | undefined;
	try {
		appContext = useAppContext();
	} catch {
		appContext = undefined;
	}

	/** ファイル拡張子を正規化（mdは除外） */
	const normalizedExtension = $derived(
		extension && extension.toLowerCase() !== "md"
			? extension.toLowerCase()
			: undefined,
	);

	/** 拡張子に応じたアイコン名（ICONS のキー） */
	const fileIconName = $derived.by((): IconName | null => {
		if (!normalizedExtension) return null;
		return getFileIconName(normalizedExtension);
	});

	/** 拡張子から表示するアイコン名を判定 */
	function getFileIconName(ext: string): IconName {
		if (IMAGE_EXTENSIONS.has(ext)) return "Image";
		if (ext === "pdf") return "FileText";
		if (AUDIO_EXTENSIONS.has(ext)) return "FileAudio";
		if (ext === "canvas") return "LayoutDashboard";
		if (ext === "base") return "LayoutList";
		return "File";
	}

	const isAttachmentFile = $derived(isAttachment(extension));
	const extensionClass = $derived(extension ? `ext-${extension.toLowerCase()}` : "");
	const hasSearchQuery = $derived(searchQuery.trim().length > 0);
	const bookmarkedPathSet = appContext?.bookmarks.filePaths;
	const showBookmarkIcon = $derived(
		file ? (bookmarkedPathSet?.has(file.path) ?? false) : false,
	);

	function renderHighlightedTitle(): string {
		return highlightTextForSearch(title, searchQuery);
	}
</script>

<div
	class="cosense-card-links__box {className} {extensionClass}"
	class:is-attachment={isAttachmentFile}
	role="button"
	tabindex="0"
	aria-label={ariaLabel}
	data-ccl-interaction-id={interactionId}
	data-ccl-interaction-kind={interactionKind}
	data-directory={directory}
	{draggable}
	use:interactionIdBinding={interactionId}
>
	<div class="cosense-card-links__box-title-wrapper">
		<div class="cosense-card-links__box-title">
			{#if fileIconName}
				<span class="cosense-card-links__file-icon">
					<Icon name={fileIconName} width={16} height={16} />
				</span>
			{/if}
			{#if hasSearchQuery}
				{@html renderHighlightedTitle()}
			{:else}
				{title}
			{/if}
		</div>
		{#if normalizedExtension}
			<span class="cosense-card-links__box-extension">
				{normalizedExtension}
			</span>
		{/if}
	</div>
	{@render children?.()}
	{#if showBookmarkIcon}
		<div class="cosense-card-links__box-bookmark-bg">
			<Icon
				name="Bookmark"
				width={22}
				height={22}
				fill="currentColor"
				stroke="none"
			/>
		</div>
	{/if}
</div>

<style>
	.cosense-card-links__box--existing {
		border-style: solid;
	}

	.cosense-card-links__box--missing .cosense-card-links__box-title {
		color: var(--color-base-50);
	}

	.cosense-card-links__section.twohop-links-new-links .cosense-card-links__box-title {
		color: var(--color-base-50);
	}
</style>
