<script lang="ts">
	import { Component, Notice, TFile, TFolder, type App } from "obsidian";
	import {
		getViewItemKey,
		toViewItems,
		type ViewItem,
	} from "application/presenters/ViewItem";
	import { resolveExpectedPath } from "shared/obsidian/resolveExpectedPath";
	import SearchableItemList from "features/list-view/ui/SearchableItemList.svelte";
	import type { ListConfig } from "features/list-view/ui/types";
	import type { LinkContext } from "ui/context/linkContext";
	import type { PluginSettings } from "features/settings/model";
	import type { ISortService } from "core/sorting";
	import type { ApplicationUiState } from "application/stores/ApplicationUiState.svelte";
	import { getCardLayoutCssText } from "ui/layout/cardLayoutCssVars";
	import { getFileCardTitleSearchText } from "core/frontmatterCardTitle";
	import type { PreviewRuntime } from "features/card-preview/runtime/previewRuntime";

	interface Props {
		app: App;
		settings: PluginSettings;
		sortService: ISortService;
		linkContext: LinkContext;
		applicationStore: ApplicationUiState;
		previewRuntime?: PreviewRuntime;
	}

	let {
		app,
		settings,
		sortService,
		linkContext,
		applicationStore,
		previewRuntime = undefined,
	}: Props = $props();

	let notesVersion = $state(0);
	let cardLayoutCssText = $derived(getCardLayoutCssText(settings));
	let isCreatingSearchNote = $state(false);

	let notes = $derived.by(() => {
		void notesVersion;
		return app.vault
			.getFiles()
			.filter((f) => f.extension === "md" || f.extension === "canvas");
	});

	let noteViewItems = $derived(toViewItems(notes));

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

	const listConfig: ListConfig<ViewItem> = {
		title: "All notes",
		paginationMode: "infinite-scroll",
		preserveResultsHeightOnSearch: false,
		searchEnabled: true,
		allowContentSearch: true,
		searchPlaceholder: "Search note titles...",
		getSearchText: (item: ViewItem, ctx) => {
			if (item.type !== "file") return "";
			return getFileCardTitleSearchText(
				item.data,
				ctx.sourceFile.path,
				ctx.fileToLinktext,
				ctx.getMetadata,
				settings.priorityFrontmatterKeyForTitle,
			);
		},
		getItemKey: getViewItemKey,
		sectionId: "empty-view-all-notes",
		pinBookmarkedToTop: settings.pinBookmarkedToTopInAllNotes,
		emptyMessage: "No notes found.",
		onSearchSubmit: createNoteFromSearchTitle,
	};

	$effect(() => {
		const component = new Component();

		component.registerEvent(
			app.vault.on("create", (file) => {
				if (
					file instanceof TFile &&
					(file.extension === "md" || file.extension === "canvas")
				) {
					notesVersion += 1;
				}
			}),
		);

		component.registerEvent(
			app.vault.on("delete", (file) => {
				if (
					file instanceof TFile &&
					(file.extension === "md" || file.extension === "canvas")
				) {
					notesVersion += 1;
				}
			}),
		);

		component.registerEvent(
			app.vault.on("rename", (file, oldPath) => {
				if (!(file instanceof TFile)) {
					return;
				}

				const wasNote =
					oldPath.toLowerCase().endsWith(".md") ||
					oldPath.toLowerCase().endsWith(".canvas");
				if (file.extension === "md" || file.extension === "canvas" || wasNote) {
					notesVersion += 1;
				}
			}),
		);

		return () => {
			component.unload();
		};
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
