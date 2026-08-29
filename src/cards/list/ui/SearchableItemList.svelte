<script lang="ts">
	import { setContext } from "svelte";
	import ViewItemCard from "./ViewItemCard.svelte";
	import ListControls from "cards/components/ListControls.svelte";
	import LinkList from "cards/grid/ui/FlatCardGrid.svelte";
	import LinkSectionHeader from "cards/components/LinkSectionHeader.svelte";
	import { buildScopedSectionId } from "cards/components/listPagination";
	import { useSearchQuery } from "cards/hooks/useSearchQuery.svelte";
	import { useBookmarks } from "cards/hooks/useBookmarks.svelte";
	import {
		useStreamingSearchSession,
		type SearchDatasetSnapshot,
		type SearchMatchSnapshot,
	} from "search/useStreamingSearchSession.svelte";
	import { focusResultEdge } from "cards/navigation/resultFocus";
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
	import type { SearchItemSnapshot, SearchMatchScope } from "search/searchTypes";
	import {
		getSortedViewItems,
		pinBookmarkedViewItems,
	} from "cards/list/model/searchableItemSorting";
	import { tick, untrack } from "svelte";
	import {
		createCardRenderModel,
		type CardRenderModel,
	} from "cards/rendering/cardRenderModel";
	import { createItemInteractionKey } from "cards/interactions/interactionTypes";
	import type { PreviewRuntime } from "card-preview/runtime/previewRuntime";
	import type { ListViewUiState } from "cards/list/model/listViewUiState";

	interface SearchablePresentation {
		readonly result: SearchMatchSnapshot | null;
		readonly items: readonly CardItem[];
		readonly consumedMatchCount: number;
		readonly sourceItems: readonly CardItem[] | null;
	}

	interface Props {
		items: CardItem[];
		config: ListConfig<CardItem>;
		linkContext: LinkContext;
		applicationStore: ListViewState;
		sortService: ISortService;
		app: App;
		previewRuntime?: PreviewRuntime;
		autofocus?: boolean;
		uiState?: ListViewUiState;
		itemsRevision?: number;
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
		uiState = undefined,
		itemsRevision = 0,
	}: Props = $props();

	let sortOption = $derived(applicationStore.sortOption);
	let sortSettingsSignature = $derived(
		[
			applicationStore.settings?.frontmatterKeyCreatedDate ?? "",
			applicationStore.settings?.frontmatterKeyModifiedDate ?? "",
			applicationStore.settings?.priorityFrontmatterKeyForTitle ?? "",
			applicationStore.updateVersion,
			itemsRevision,
		].join("\u001f"),
	);
	let getItemKey = $derived(config.getItemKey);

	let searchEnabled = $derived(config.searchEnabled ?? true);
	let allowContentSearch = $derived(config.allowContentSearch ?? true);

	const search = useSearchQuery({
		initialValue: uiState?.searchInputValue,
		onInputChange: (value) => {
			if (!uiState) return;
			if (value !== uiState.searchInputValue) {
				uiState.scrollState = undefined;
			}
			uiState.searchInputValue = value;
		},
	});
	let contentSearchEnabled = $state(false);
	const contentSearchEnabledSetting = $derived(
		applicationStore.settings?.enableContentSearch ?? false,
	);
	let searchMatchScope = $derived.by(
		(): SearchMatchScope =>
			allowContentSearch && contentSearchEnabled
				? "title-and-content"
				: "title-only",
	);

	function syncContentSearchToggleFromSettings(): void {
		contentSearchEnabled = contentSearchEnabledSetting;
	}

	const searchTextCache = createItemSearchTextCache();

	function clearSearchTextCacheForInputChange(): void {
		void items;
		void itemsRevision;
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
	const bookmarks = useBookmarks(app);
	let sortedItems = $derived.by(() => {
		void sortSettingsSignature;
		if (config.getSortedItems) {
			return config.getSortedItems(sortOption);
		}
		return getSortedViewItems(items, sortOption, sortService, (raw) =>
			toCardItem(raw),
		);
	});
	let orderedItems = $derived.by(() => {
		const sourceItems = sortedItems;
		const shouldPin = config.pinBookmarkedToTop;
		void bookmarks.filePaths.size;
		void bookmarks.orderedFilePaths;
		return shouldPin ? pinBookmarkedViewItems(sourceItems, bookmarks) : sourceItems;
	});
	let orderedItemByKey = $derived.by(() => {
		const byKey = new Map<string, CardItem>();
		for (const item of orderedItems) byKey.set(getItemKey(item), item);
		return byKey;
	});
	const buildSearchSnapshot = (): SearchDatasetSnapshot => {
		void itemsRevision;
		const searchItems: SearchItemSnapshot[] = [];
		const filesByPath = new Map<string, TFile>();
		for (const item of orderedItems) {
			const targetFile = getItemTargetFile(item, linkContext);
			if (targetFile) filesByPath.set(targetFile.path, targetFile);
			searchItems.push({
				key: getItemKey(item),
				searchText: getCachedItemSearchText(item),
				targetFilePath: targetFile?.path ?? null,
			});
		}
		return {
			items: searchItems,
			searchableFiles: Array.from(filesByPath.values()),
		};
	};

	setLinkContext(linkContext);
	setContext<ListViewState>("applicationStore", applicationStore);
	const searchSession = useStreamingSearchSession({
		app,
		query: () => search.normalized,
		enabled: () => searchEnabled && !!search.normalized,
		matchScope: () => searchMatchScope,
		buildSnapshot: buildSearchSnapshot,
	});

	setAppContext({
		linkContext,
		applicationStore,
		app,
		bookmarks,
		previewRuntime,
		resolveSearchMatchPosition: (query, file) =>
			searchSession.resolveFirstMatchPosition(query, file),
		resolveSearchMatchOffset: (query, file) =>
			searchSession.getFirstMatchOffset(query, file),
	});
	const lazyLoaderCache = new Set<string>();
	setLazyLoaderCache(lazyLoaderCache);
	let isSearchLoading = $derived(searchSession.isPending);

	let presentation = $state.raw<SearchablePresentation>({
		result: null,
		items: [],
		consumedMatchCount: 0,
		sourceItems: null,
	});
	let filteredItems = $derived(presentation.items);
	let gridItemsRevision = $derived(
		searchEnabled && search.normalized ? presentation.result?.requestId : undefined,
	);
	let appliedSearchQuery = $derived(presentation.result?.query ?? "");
	let appliedSearchScope = $derived(presentation.result?.scope ?? "title-only");
	$effect(() => {
		void itemsRevision;
		const sourceItems = orderedItems;
		const itemByKey = orderedItemByKey;
		const query = search.normalized;
		const visibleResult = searchSession.visibleResult;
		const currentPresentation = untrack(() => presentation);
		if (!searchEnabled || !query) {
			presentation = {
				result: null,
				items: sourceItems,
				consumedMatchCount: 0,
				sourceItems,
			};
			return;
		}
		if (visibleResult?.type === "stale") return;
		const result = visibleResult?.result ?? null;

		if (!result) {
			if (
				currentPresentation.result !== null ||
				currentPresentation.items.length > 0
			) {
				presentation = {
					result: null,
					items: [],
					consumedMatchCount: 0,
					sourceItems,
				};
			}
			return;
		}

		const continuesCurrentRun =
			currentPresentation.result?.requestId === result.requestId &&
			currentPresentation.sourceItems === sourceItems;
		const consumedMatchCount = continuesCurrentRun
			? currentPresentation.consumedMatchCount
			: 0;
		const addedItems: CardItem[] = [];
		for (
			let index = consumedMatchCount;
			index < result.orderedMatches.length;
			index += 1
		) {
			const item = itemByKey.get(result.orderedMatches[index].key);
			if (item) addedItems.push(item);
		}

		presentation = {
			result,
			items: continuesCurrentRun
				? [...currentPresentation.items, ...addedItems]
				: addedItems,
			consumedMatchCount: result.orderedMatches.length,
			sourceItems,
		};
	});

	let initialVisibleCount = $derived(applicationStore.initialVisibleCount);
	let searchScopedSectionId = $derived(
		buildScopedSectionId(
			config.sectionId,
			JSON.stringify([
				presentation.result?.query ?? "",
				presentation.result?.scope ?? "none",
			]),
		),
	);
	let loadMoreIncrement = $derived(applicationStore.loadMoreIncrement);
	let preserveResultsHeightOnSearch = $derived(
		config.preserveResultsHeightOnSearch ?? true,
	);
	const cardModelRevision = $derived.by(() => ({
		items: presentation.items,
		itemsRevision,
		getItemKey,
		settings: applicationStore.settings,
		searchQuery: presentation.result?.query ?? "",
		searchScope: presentation.result?.scope ?? "title-only",
		matchesByKey: presentation.result?.matchesByKey ?? null,
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
			revision.searchScope === "title-and-content" &&
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
	class:ccl-search-pending={isSearchLoading}
	aria-busy={isSearchLoading}
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
			itemsRevision={gridItemsRevision}
			getItemId={getItemKey}
			sectionId={searchScopedSectionId}
			{applicationStore}
			{initialVisibleCount}
			{loadMoreIncrement}
			paginationMode={config.paginationMode ?? "button"}
			initialScrollState={uiState?.scrollState}
			onScrollStateChange={(scrollState) => {
				if (!uiState) return;
				const currentInputQuery = uiState.searchInputValue.trim().toLowerCase();
				if (
					currentInputQuery &&
					(searchSession.phase !== "ready" ||
						presentation.result !== searchSession.visibleResult?.result)
				) {
					return;
				}
				uiState.scrollState = scrollState;
			}}
			{resolveItemPreviewRequest}
			{resolveItemInteractionDescriptor}
			header={config.showSectionHeader ? sectionHeader : undefined}
		>
			{#snippet item({ item, previewKey })}
				<ViewItemCard model={resolveViewItemCardModel(item)} {previewKey} />
			{/snippet}
		</LinkList>
		{#if isSearchLoading}
			<div class="cosense-card-links__search-status" aria-live="polite">
				Searching…
			</div>
		{/if}
	{:else}
		<div class="modal-empty">
			{#if isSearchLoading}
				Searching…
			{:else if searchEnabled && search.normalized && searchSession.phase === "ready"}
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

	.cosense-card-links__search-status {
		padding: 6px 12px;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}
</style>
