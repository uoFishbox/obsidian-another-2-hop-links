<script lang="ts">
	import type { PluginSettings } from "types/settings";
	import { type TFile } from "obsidian";
	import { svgAttrs, ICON_PATHS } from "ui/utils/icons";
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

	type FileIconKind =
		| "image"
		| "file-text"
		| "file-audio"
		| "layout-dashboard"
		| "layout-list"
		| "file";

	/** 拡張子に応じたアイコン種別 */
	const fileIconKind = $derived.by((): FileIconKind | null => {
		if (!normalizedExtension) return null;
		return getFileIconKind(normalizedExtension);
	});

	/** 拡張子からObsidianアイコンIDを判定 */
	function getFileIconKind(ext: string): FileIconKind {
		if (IMAGE_EXTENSIONS.has(ext)) return "image";
		if (ext === "pdf") return "file-text";
		if (AUDIO_EXTENSIONS.has(ext)) return "file-audio";
		if (ext === "canvas") return "layout-dashboard";
		if (ext === "base") return "layout-list";
		return "file";
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
			{#if fileIconKind}
				<span class="cosense-card-links__file-icon">
					{#if fileIconKind === "image"}
						<svg
							{...svgAttrs}
							width="16"
							height="16"
							stroke="currentColor"
							aria-hidden="true"
						>
							{@html ICON_PATHS.Image}
						</svg>
					{:else if fileIconKind === "file-text"}
						<svg
							{...svgAttrs}
							width="16"
							height="16"
							stroke="currentColor"
							aria-hidden="true"
						>
							{@html ICON_PATHS.FileText}
						</svg>
					{:else if fileIconKind === "file-audio"}
						<svg
							{...svgAttrs}
							width="16"
							height="16"
							stroke="currentColor"
							aria-hidden="true"
						>
							{@html ICON_PATHS.FileAudio}
						</svg>
					{:else if fileIconKind === "layout-dashboard"}
						<svg
							{...svgAttrs}
							width="16"
							height="16"
							stroke="currentColor"
							aria-hidden="true"
						>
							{@html ICON_PATHS.LayoutDashboard}
						</svg>
					{:else if fileIconKind === "layout-list"}
						<svg
							{...svgAttrs}
							width="16"
							height="16"
							stroke="currentColor"
							aria-hidden="true"
						>
							{@html ICON_PATHS.LayoutList}
						</svg>
					{:else}
						<svg
							{...svgAttrs}
							width="16"
							height="16"
							stroke="currentColor"
							aria-hidden="true"
						>
							{@html ICON_PATHS.File}
						</svg>
					{/if}
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
			<svg {...svgAttrs} width="22" height="22" fill="currentColor" stroke="none">
				{@html ICON_PATHS.Bookmark}
			</svg>
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
