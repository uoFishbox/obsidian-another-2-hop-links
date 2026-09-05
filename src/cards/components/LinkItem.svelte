<script lang="ts">
	import { type TFile } from "obsidian";
	import Icon from "shared/ui/primitives/Icon.svelte";
	import { type IconName } from "shared/ui/icons/iconRegistry";
	import { isAttachment } from "obsidian-integration/files/fileRules";
	import { isImageExtension } from "card-preview/fileTypes";
	import { type Snippet } from "svelte";
	import { useAppContext } from "cards/context/linkContext";
	import { highlightTextForSearch } from "card-preview/text/searchHighlighter";
	import type { InteractionHandle } from "cards/interactions/interactionTypes";

	const AUDIO_EXTENSIONS = new Set([
		"mp3",
		"wav",
		"m4a",
		"ogg",
		"oga",
		"opus",
		"3gp",
		"flac",
		"aac",
	]);

	interface Props {
		title: string;
		ariaLabel: string;
		interactionHandle: InteractionHandle;
		interactive?: boolean;
		draggable?: boolean;
		children?: Snippet;
		className?: string;
		extension?: string;
		file?: TFile | null;
		searchQuery?: string;
	}

	let {
		title,
		ariaLabel,
		interactionHandle,
		interactive = true,
		draggable = true,
		children,
		className = "",
		extension,
		file = null,
		searchQuery = "",
	}: Props = $props();

	let appContext: ReturnType<typeof useAppContext> | undefined;
	try {
		appContext = useAppContext();
	} catch {
		appContext = undefined;
	}

	const lowerExtension = $derived(extension?.toLowerCase());

	/** ファイル拡張子を正規化（mdは除外） */
	const normalizedExtension = $derived(
		lowerExtension && lowerExtension !== "md" ? lowerExtension : undefined,
	);

	/** 拡張子に応じたアイコン名（ICONS のキー） */
	const fileIconName = $derived.by((): IconName | null => {
		if (!normalizedExtension) return null;
		return getFileIconName(normalizedExtension);
	});

	/** 拡張子から表示するアイコン名を判定 */
	function getFileIconName(ext: string): IconName {
		if (isImageExtension(ext)) return "Image";
		if (ext === "pdf") return "FileText";
		if (AUDIO_EXTENSIONS.has(ext)) return "FileAudio";
		if (ext === "canvas") return "LayoutDashboard";
		if (ext === "base") return "LayoutList";
		return "File";
	}

	const isAttachmentFile = $derived(isAttachment(extension));
	const extensionClass = $derived(lowerExtension ? `ext-${lowerExtension}` : "");
	const hasSearchQuery = $derived(searchQuery.trim().length > 0);
	const bookmarkedPathSet = appContext?.bookmarks.filePaths;
	const showBookmarkIcon = $derived(
		file ? (bookmarkedPathSet?.has(file.path) ?? false) : false,
	);

	function renderHighlightedTitle(): string {
		return highlightTextForSearch(title, searchQuery);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="cosense-card-links__box {className} {extensionClass}"
	class:is-attachment={isAttachmentFile}
	role={interactive ? "button" : undefined}
	tabindex={interactive ? 0 : undefined}
	aria-label={interactive ? ariaLabel : undefined}
	aria-hidden={interactive ? undefined : "true"}
	data-ccl-interaction-handle={interactive ? interactionHandle : undefined}
	draggable={interactive && draggable ? true : undefined}
>
	<div class="cosense-card-links__box-title-wrapper">
		<div
			class="cosense-card-links__box-title"
			class:has-file-icon={fileIconName !== null}
		>
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
</style>
