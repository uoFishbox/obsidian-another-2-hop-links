<script lang="ts">
	import { setContext } from "svelte";
	import ViewItemCard from "./ViewItemCard.svelte";
	import ListControls from "cards/components/ListControls.svelte";
	import LinkList from "cards/grid/ui/FlatCardGrid.svelte";
	import LinkSectionHeader from "cards/components/LinkSectionHeader.svelte";
	import { buildScopedSectionId } from "cards/components/listPagination";
	import { useSearchQuery } from "cards/hooks/useSearchQuery.svelte";
	import { useBookmarks } from "cards/hooks/useBookmarks.svelte";
	import { useWorkerSearchSession } from "search/useWorkerSearchSession.svelte";
	import { focusResultEdge } from "cards/navigation/resultFocus";
	import { yieldToMainThreadIdleAware } from "indexing/timeSlicing";
	import type { ListConfig } from "./types";
	import {
		setLinkContext,
		type LinkContext,
		setAppContext,
		setLazyLoaderCache,
	} from "cards/context/linkContext";
	import type { ISortService } from "cards/sorting";
	import type { ListViewState } from "cards/list/model/ListViewState";
	import type { App, TFile } from "obsidian";
	import { getItemTargetFile, toCardItem, type CardItem } from "cards/CardItem";
	import {
		createItemSearchTextCache,
		getItemSearchText,
	} from "cards/list/model/itemSearchText";
	import type { SearchWorkerItemSnapshot } from "search/searchWorkerTypes";
	import {
		getSortedViewItems,
		pinBookmarkedViewItems,
	} from "cards/list/model/searchableItemSorting";
	import { tick } from "svelte";
	import {
		createCardRenderModel,
		type CardRenderModel,
	} from "cards/rendering/cardRenderModel";
	import { createItemInteractionKey } from "cards/interactions/interactionTypes";
	import type { PreviewRuntime } from "preview/runtime/previewRuntime";

	const SEARCH_FILTER_YIELD_CHECK_INTERVAL = 128;
	const SEARCH_FILTER_YIELD_MAX_DELAY_MS = 16;

	interface Props {
		items: CardItem[];
		config: ListConfig<CardItem>;
		linkContext: LinkContext;
		applicationStore: ListViewState;
		sortService: ISortService;
		app: App;
		previewRuntime?: PreviewRuntime;
		autofocus?: boolean;
	}

	let {
		items,
		config,
		linkContext,
		applicationStore,
		sortService,
		app,
		previewRuntime = undefined,
		autofocus = true,
	}: Props = $props();

	let sortOption = $derived(applicationStore.sortOption);
	let sortSettingsSignature = $derived(
		[
			applicationStore.settings?.frontmatterKeyCreatedDate ?? "",
			applicationStore.settings?.frontmatterKeyModifiedDate ?? "",
			applicationStore.settings?.priorityFrontmatterKeyForTitle ?? "",
			applicationStore.updateVersion,
		].join("\u001f"),
	);
	let getItemKey = $derived(config.getItemKey);

	let searchEnabled = $derived(config.searchEnabled ?? true);
	let allowContentSearch = $derived(config.allowContentSearch ?? true);

	const search = useSearchQuery();
	let contentSearchEnabled = $state(false);
	const contentSearchEnabledSetting = $derived(
		applicationStore.settings?.enableContentSearch ?? false,
	);

	function syncContentSearchToggleFromSettings(): void {
		contentSearchEnabled = contentSearchEnabledSetting;
	}

	const searchTextCache = createItemSearchTextCache();

	function clearSearchTextCacheForInputChange(): void {
		void items;
		void linkContext.sourceFile.path;
		void config.getItemKey;
		void config.getSearchText;
		void applicationStore.updateVersion;
		void applicationStore.settings?.priorityFrontmatterKeyForTitle;
		searchTextCache.clear();
	}

	$effect(() => {
		syncContentSearchToggleFromSettings();
	});

	$effect.pre(() => {
		clearSearchTextCacheForInputChange();
	});

	const getCachedItemSearchText = (item: CardItem): string => {
		const key = getItemKey(item);
		return searchTextCache.get(key, () =>
			(config.getSearchText
				? config.getSearchText(item, linkContext)
				: getItemSearchText(item, linkContext, {
						priorityFrontmatterKeyForTitle:
							applicationStore.settings?.priorityFrontmatterKeyForTitle ??
							"",
					})
			).toLowerCase(),
		);
	};
	const buildWorkerDataset = (): SearchWorkerItemSnapshot[] => {
		return items.map((item) => ({
			key: getItemKey(item),
			searchText: getCachedItemSearchText(item),
			targetFilePath: getItemTargetFile(item, linkContext)?.path ?? null,
		}));
	};
	const getSearchableFiles = (): TFile[] => {
		const filesByPath = new Map<string, TFile>();
		for (const item of items) {
			const targetFile = getItemTargetFile(item, linkContext);
			if (targetFile) {
				filesByPath.set(targetFile.path, targetFile);
			}
		}
		return Array.from(filesByPath.values());
	};

	setLinkContext(linkContext);
	setContext<ListViewState>("applicationStore", applicationStore);
	const bookmarks = useBookmarks(app);
	const workerSearchSession = useWorkerSearchSession({
		app,
		query: () => search.normalized,
		enabled: () => searchEnabled && !!search.normalized,
		contentIndexEnabled: () => searchEnabled,
		matchScope: () =>
			allowContentSearch && contentSearchEnabled
				? "title-and-content"
				: "title-only",
		getSearchableFiles,
		buildDataset: buildWorkerDataset,
	});

	setAppContext({
		linkContext,
		applicationStore,
		app,
		bookmarks,
		previewRuntime,
		resolveSearchMatchPosition: (query, file) =>
			workerSearchSession.getFirstMatchPosition(query, file),
	});
	const lazyLoaderCache = new Set<string>();
	setLazyLoaderCache(lazyLoaderCache);
	let matchesByKey = $derived(workerSearchSession.matchesByKey);
	let isSearchLoading = $derived(workerSearchSession.isLoading);

	let sortedItems = $derived.by(() => {
		void sortSettingsSignature;
		return getSortedViewItems(items, sortOption, sortService, (raw) =>
			toCardItem(raw),
		);
	});

	let filteredItems = $state.raw<CardItem[]>([]);
	let filterRunSerial = 0;

	$effect(() => {
		const serial = ++filterRunSerial;
		const sourceItems = sortedItems;
		const query = search.normalized;
		const matches = matchesByKey;
		const shouldPin = config.pinBookmarkedToTop;
		void bookmarks.filePaths.size;
		void bookmarks.orderedFilePaths;

		void (async () => {
			if (!searchEnabled || !query) {
				filteredItems = shouldPin
					? pinBookmarkedViewItems(sourceItems, bookmarks)
					: sourceItems;
				return;
			}

			if (!matches) {
				// Stale-while-search: keep the previous results while the
				// search worker has not produced a result for the current
				// query yet. Clearing `filteredItems` here would unmount
				// LinkList and destroy the preview host with it.
				return;
			}

			const nextItems: CardItem[] = [];
			let lastPublish = performance.now();

			for (let index = 0; index < sourceItems.length; index += 1) {
				if (serial !== filterRunSerial) {
					return;
				}

				const item = sourceItems[index];
				if (matches.has(getItemKey(item))) {
					nextItems.push(item);
				}

				if ((index + 1) % SEARCH_FILTER_YIELD_CHECK_INTERVAL !== 0) {
					continue;
				}

				const now = performance.now();
				if (now - lastPublish <= SEARCH_FILTER_YIELD_MAX_DELAY_MS) {
					continue;
				}

				filteredItems = nextItems.slice();
				await yieldToMainThreadIdleAware({
					maxDelayMs: SEARCH_FILTER_YIELD_MAX_DELAY_MS,
				});
				lastPublish = performance.now();
			}

			if (serial !== filterRunSerial) {
				return;
			}

			filteredItems = shouldPin
				? pinBookmarkedViewItems(nextItems, bookmarks)
				: nextItems;
		})();
	});

	let initialVisibleCount = $derived(applicationStore.initialVisibleCount);
	let searchScopedSectionId = $derived(
		buildScopedSectionId(config.sectionId, search.normalized),
	);
	let loadMoreIncrement = $derived(applicationStore.loadMoreIncrement);
	let preserveResultsHeightOnSearch = $derived(
		config.preserveResultsHeightOnSearch ?? true,
	);
	const cardModelRevision = $derived.by(() => ({
		items,
		getItemKey,
		settings: applicationStore.settings,
		searchQuery: search.normalized,
		contentSearchEnabled,
		allowContentSearch,
		matchesByKey,
		applicationUpdateVersion: applicationStore.updateVersion,
		previewGlobalVersion: applicationStore.previewState.globalVersion,
		previewPathVersions: applicationStore.previewState.pathVersions,
		modelsByKey: new Map<string, { item: CardItem; model: CardRenderModel }>(),
	}));

	function resolveViewItemCardModel(
		item: CardItem,
		revision = cardModelRevision,
	): CardRenderModel {
		const itemKey = getItemKey(item);
		const cached = revision.modelsByKey.get(itemKey);
		if (cached?.item === item) {
			return cached.model;
		}

		const matchedItem = revision.matchesByKey?.get(itemKey) ?? null;
		const searchScope =
			revision.allowContentSearch &&
			revision.contentSearchEnabled &&
			(matchedItem?.contentMatched ?? true)
				? "title-and-content"
				: "title-only";
		const interactionId = createItemInteractionKey(item, itemKey);
		const model = createCardRenderModel({
			item,
			settings: revision.settings,
			context: linkContext,
			getPreviewRenderVersion: (path) =>
				applicationStore.previewState.getRenderVersion(path),
			searchQuery: revision.searchQuery,
			searchScope,
			contentPreview: matchedItem?.contentPreview,
			interactionId,
		});
		revision.modelsByKey.set(itemKey, { item, model });
		return model;
	}

	const resolveItemPreviewRequest = $derived.by(() => {
		const revision = cardModelRevision;
		return (item: CardItem) =>
			resolveViewItemCardModel(item, revision).previewRequest;
	});
	const resolveItemInteractionDescriptor = $derived.by(() => {
		const revision = cardModelRevision;
		return (item: CardItem) =>
			resolveViewItemCardModel(item, revision).interactionDescriptor;
	});

	let resultsContainerEl = $state<HTMLDivElement | null>(null);
	let resultsMinHeight = $derived(
		preserveResultsHeightOnSearch && searchEnabled && search.normalized
			? "100vh"
			: null,
	);

	async function moveFocusToResults(direction: "up" | "down") {
		await tick();
		focusResultEdge(resultsContainerEl, direction);
	}
</script>

<ListControls
	searchInputValue={search.value}
	onSearchInput={(value) => (search.value = value)}
	onSearchSubmit={config.onSearchSubmit}
	onToggleContentSearch={() => {
		const newValue = !contentSearchEnabled;
		contentSearchEnabled = newValue;
		applicationStore.setContentSearchEnabled(newValue);
	}}
	{contentSearchEnabled}
	{sortOption}
	onSortChange={(opt) => applicationStore.setSortOption(opt)}
	onMoveFocusToResults={moveFocusToResults}
	showSearchInput={searchEnabled}
	showContentSearchToggle={allowContentSearch}
	searchPlaceholder={config.searchPlaceholder ?? "Search..."}
	{autofocus}
/>

<div
	class="cosense-card-links__view-results cosense-card-links__search-result-container"
	class:is-loading={isSearchLoading}
	bind:this={resultsContainerEl}
	style:min-height={resultsMinHeight}
>
	{#if filteredItems.length}
		{#snippet sectionHeader()}
			<LinkSectionHeader
				title={config.sectionHeaderTitle ?? config.title}
				totalCount={filteredItems.length}
			/>
		{/snippet}

		<LinkList
			className="cosense-card-links__section twohop-links-back-links"
			items={filteredItems}
			getItemId={getItemKey}
			sectionId={searchScopedSectionId}
			{applicationStore}
			{initialVisibleCount}
			{loadMoreIncrement}
			paginationMode={config.paginationMode ?? "button"}
			{resolveItemPreviewRequest}
			{resolveItemInteractionDescriptor}
			header={config.showSectionHeader ? sectionHeader : undefined}
		>
			{#snippet item({ item, previewKey })}
				<ViewItemCard model={resolveViewItemCardModel(item)} {previewKey} />
			{/snippet}
		</LinkList>
	{:else}
		<div class="modal-empty">
			{#if searchEnabled && search.normalized}
				No matches found.
			{:else}
				{config.emptyMessage}
			{/if}
		</div>
	{/if}
</div>

<style>
	.cosense-card-links__search-result-container {
		overflow-anchor: none;
	}

	.modal-empty {
		padding: 40px 20px;
		text-align: center;
		color: var(--text-muted);
	}
</style>
