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
		type SearchMatchSnapshot,
	} from "search/useStreamingSearchSession.svelte";
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
	import type { SearchItemSnapshot } from "search/searchTypes";
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
	import type { PreviewRuntime } from "preview/runtime/previewRuntime";
	import type { ListViewUiState } from "cards/list/model/listViewUiState";

	const SEARCH_FILTER_YIELD_CHECK_INTERVAL = 128;
	const SEARCH_FILTER_YIELD_MAX_DELAY_MS = 16;

	interface SearchablePresentation {
		readonly result: SearchMatchSnapshot | null;
		readonly items: readonly CardItem[];
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
	const buildSearchDataset = (): SearchItemSnapshot[] => {
		void itemsRevision;
		return items.map((item) => ({
			key: getItemKey(item),
			searchText: getCachedItemSearchText(item),
			targetFilePath: getItemTargetFile(item, linkContext)?.path ?? null,
		}));
	};
	const getSearchableFiles = (): TFile[] => {
		void itemsRevision;
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
	const searchSession = useStreamingSearchSession({
		app,
		query: () => search.normalized,
		enabled: () => searchEnabled && !!search.normalized,
		matchScope: () =>
			allowContentSearch && contentSearchEnabled
				? "title-and-content"
				: "title-only",
		getSearchableFiles,
		buildDataset: buildSearchDataset,
	});

	setAppContext({
		linkContext,
		applicationStore,
		app,
		bookmarks,
		previewRuntime,
		resolveSearchMatchPosition: (query, file) =>
			searchSession.getFirstMatchPosition(query, file),
	});
	const lazyLoaderCache = new Set<string>();
	setLazyLoaderCache(lazyLoaderCache);
	let isSearchLoading = $derived(searchSession.isPending);

	let sortedItems = $derived.by(() => {
		void sortSettingsSignature;
		if (config.getSortedItems) {
			return config.getSortedItems(sortOption);
		}
		return getSortedViewItems(items, sortOption, sortService, (raw) =>
			toCardItem(raw),
		);
	});

	let presentation = $state.raw<SearchablePresentation>({
		result: null,
		items: [],
	});
	let filteredItems = $derived(presentation.items);
	let appliedSearchQuery = $derived(presentation.result?.query ?? "");
	let appliedSearchScope = $derived(presentation.result?.scope ?? "title-only");
	let filterRunSerial = 0;

	$effect(() => {
		const serial = ++filterRunSerial;
		void itemsRevision;
		const sourceItems = sortedItems;
		const query = search.normalized;
		const committedResult = searchSession.committedResult;
		const progressiveResult = searchSession.progressiveResult;
		const result =
			searchSession.currentResult ??
			(progressiveResult?.query === query ? progressiveResult : null);
		const shouldPin = config.pinBookmarkedToTop;
		void bookmarks.filePaths.size;
		void bookmarks.orderedFilePaths;

		void (async () => {
			if (!searchEnabled || !query) {
				const nextItems = shouldPin
					? pinBookmarkedViewItems(sourceItems, bookmarks)
					: sourceItems;
				const currentItems = untrack(() => presentation.items);
				presentation = {
					result: null,
					items: nextItems === currentItems ? [...nextItems] : nextItems,
				};
				return;
			}

			if (!result) {
				const visibleResult = untrack(() => presentation.result);
				if (committedResult === null && visibleResult !== null) {
					// A provisional result belongs only to its exact query. Keeping it
					// here would leave prefix-query cards/highlights visible after input.
					presentation = { result: null, items: [] };
				}
				return;
			}

			const nextItems: CardItem[] = [];
			let lastPublish = performance.now();

			for (let index = 0; index < sourceItems.length; index += 1) {
				if (serial !== filterRunSerial) {
					return;
				}

				const item = sourceItems[index];
				if (result.matchesByKey.has(getItemKey(item))) {
					nextItems.push(item);
				}

				if ((index + 1) % SEARCH_FILTER_YIELD_CHECK_INTERVAL !== 0) {
					continue;
				}

				const now = performance.now();
				if (now - lastPublish <= SEARCH_FILTER_YIELD_MAX_DELAY_MS) {
					continue;
				}

				await yieldToMainThreadIdleAware({
					maxDelayMs: SEARCH_FILTER_YIELD_MAX_DELAY_MS,
				});
				lastPublish = performance.now();
			}

			const resultIsStillCurrent =
				searchSession.currentResult === result ||
				searchSession.progressiveResult === result;
			if (serial !== filterRunSerial || !resultIsStillCurrent) {
				return;
			}

			presentation = {
				result,
				items: shouldPin
					? pinBookmarkedViewItems(nextItems, bookmarks)
					: nextItems,
			};
		})();
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
						presentation.result !== searchSession.currentResult)
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
