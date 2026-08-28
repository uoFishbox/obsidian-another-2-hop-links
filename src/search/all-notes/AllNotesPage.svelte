<script lang="ts">
	import { Notice, TFile, TFolder, type App } from "obsidian";
	import { getCardItemKey, type CardItem } from "cards/CardItem";
	import { resolveExpectedPath } from "obsidian-integration/files/resolveExpectedPath";
	import SearchableItemList from "cards/list/ui/SearchableItemList.svelte";
	import type { ListConfig } from "cards/list/ui/types";
	import type { LinkContext } from "cards/context/linkContext";
	import type { PluginSettings } from "settings/model";
	import type { ISortService } from "cards/sorting";
	import type { CardCollectionState } from "cards/CardCollectionState.svelte";
	import { getCardLayoutCssText } from "cards/layout/cardLayoutCssVars";
	import { getFileCardTitleSearchText } from "cards/title/cardTitle";
	import type { PreviewRuntime } from "card-preview/runtime/previewRuntime";
	import type { ListViewUiState } from "cards/list/model/listViewUiState";
	import type { AllNotesCatalog } from "./allNotesCatalog";

	interface Props {
		app: App;
		settings: PluginSettings;
		sortService: ISortService;
		linkContext: LinkContext;
		applicationStore: CardCollectionState;
		previewRuntime?: PreviewRuntime;
		uiState?: ListViewUiState;
		allNotesCatalog: AllNotesCatalog;
	}

	let {
		app,
		settings,
		sortService,
		linkContext,
		applicationStore,
		previewRuntime = undefined,
		uiState = undefined,
		allNotesCatalog,
	}: Props = $props();

	let catalogRevision = $state(allNotesCatalog.getRevision());
	let cardLayoutCssText = $derived(getCardLayoutCssText(settings));
	let isCreatingSearchNote = $state(false);

	let noteViewItems = $derived.by(() => {
		void catalogRevision;
		return allNotesCatalog.getItems();
	});

	async function createNoteFromSearchTitle(title: string): Promise<void> {
		const trimmedTitle = title.trim();
		if (!trimmedTitle || isCreatingSearchNote) {
			return;
		}

		isCreatingSearchNote = true;

		try {
			const expectedPath = resolveExpectedPath(
				app,
				trimmedTitle,
				linkContext.sourceFile.path,
			);
			const existingFile = app.vault.getAbstractFileByPath(expectedPath);
			if (existingFile instanceof TFile) {
				await app.workspace.getLeaf(false).openFile(existingFile, {
					active: true,
				});
				return;
			}

			const lastSlashIndex = expectedPath.lastIndexOf("/");
			if (lastSlashIndex !== -1) {
				const dirPath = expectedPath.slice(0, lastSlashIndex);
				const folder = app.vault.getAbstractFileByPath(dirPath);
				if (!(folder instanceof TFolder)) {
					await app.vault.createFolder(dirPath);
				}
			}

			const file = await app.vault.create(expectedPath, "");
			await app.workspace.getLeaf(false).openFile(file, { active: true });
		} catch (error) {
			console.error(
				"[Cosense card links] Failed to create note from All notes search:",
				error,
			);
			new Notice("Failed to create note.");
		} finally {
			isCreatingSearchNote = false;
		}
	}

	const listConfig: ListConfig<CardItem> = {
		title: "All notes",
		paginationMode: "infinite-scroll",
		preserveResultsHeightOnSearch: false,
		searchEnabled: true,
		allowContentSearch: true,
		searchPlaceholder: "Search note titles...",
		getSearchText: (item: CardItem, ctx) => {
			if (item.type !== "file") return "";
			return getFileCardTitleSearchText(
				item.data,
				ctx.sourceFile.path,
				ctx.fileToLinktext,
				ctx.getMetadata,
				settings.priorityFrontmatterKeyForTitle,
			);
		},
		getItemKey: getCardItemKey,
		getSortedItems: (sortOption) => allNotesCatalog.getSortedItems(sortOption),
		sectionId: "empty-view-all-notes",
		pinBookmarkedToTop: settings.pinBookmarkedToTopInAllNotes,
		emptyMessage: "No notes found.",
		onSearchSubmit: createNoteFromSearchTitle,
	};

	$effect(() => {
		return allNotesCatalog.subscribe((revision) => {
			catalogRevision = revision;
		});
	});
</script>

<div
	class="cosense-card-links-empty-view"
	data-ccl-card-surface="empty"
	tabindex="-1"
	style={cardLayoutCssText}
>
	<SearchableItemList
		items={noteViewItems}
		config={listConfig}
		{linkContext}
		{applicationStore}
		{sortService}
		{app}
		{previewRuntime}
		autofocus={false}
		{uiState}
		itemsRevision={catalogRevision}
	/>
</div>

<style>
	.cosense-card-links-empty-view {
		width: 100%;
		margin: var(--ccl-container-margin-top) auto 0 auto;
		padding: var(--ccl-container-padding);
		box-sizing: border-box;
	}

	.cosense-card-links-empty-view :global(.twohop-header),
	.cosense-card-links-empty-view :global(.cosense-card-links__view-results) {
		max-width: calc(
			(var(--ccl-box-size) + var(--ccl-box-gap)) * var(--ccl-box-cols-max)
		);
		margin-left: auto;
		margin-right: auto;
	}
</style>
