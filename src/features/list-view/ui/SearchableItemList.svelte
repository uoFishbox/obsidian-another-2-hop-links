<script lang="ts">
	import { setContext } from "svelte";
	import ViewItemCard from "./ViewItemCard.svelte";
	import ListControls from "ui/components/common/ListControls.svelte";
	import LinkList from "features/card-grid/ui/FlatCardGrid.svelte";
	import LinkSectionHeader from "ui/components/common/LinkSectionHeader.svelte";
	import { buildScopedSectionId } from "ui/components/common/listPagination";
	import { useSearchQuery } from "ui/hooks/useSearchQuery.svelte";
	import { useBookmarks } from "ui/hooks/useBookmarks.svelte";
	import { useWorkerSearchSession } from "features/search/useWorkerSearchSession.svelte";
	import { focusResultEdge } from "features/keyboard-navigation/resultFocus";
	import { yieldToMainThreadIdleAware } from "core/indexing/timeSlicing";
	import type { ListConfig } from "./types";
	import { hasSameViewItemSource } from "application/presenters";
	import { sameArrayBy } from "shared/collections/arrayEquality";
	import {
		setLinkContext,
		type LinkContext,
		setAppContext,
		setLazyLoaderCache,
	} from "ui/context/linkContext";
	import type { ISortService, SortOption } from "core/sorting";
	import type { ListViewState } from "features/list-view/model/ListViewState";
	import type { App, TFile } from "obsidian";
	import {
		createStableViewItemReconciler,
		type ViewItem,
		toViewItem,
	} from "application/presenters";
	import {
		createItemSearchTextCache,
		getItemSearchText,
	} from "features/list-view/model/itemSearchText";
	import type { SearchWorkerItemSnapshot } from "features/search/searchWorkerTypes";
	import {
		createViewItemSortCache,
		getSortedViewItemsWithCache,
		pinBookmarkedViewItems,
	} from "features/list-view/model/searchableItemSorting";
	import { tick } from "svelte";
	import {
		createCardRenderModel,
		type CardRenderModel,
	} from "ui/components/items/cardRenderModel";
	import { createItemInteractionKey } from "ui/interactions/interactionTypes";
	import type { PreviewRuntime } from "features/card-preview/runtime/previewRuntime";
	import {
		SEARCH_FILTER_YIELD_CHECK_INTERVAL,
		SEARCH_FILTER_YIELD_MAX_DELAY_MS,
	} from "features/list-view/runtime/searchFilterTimeSlicing";

	interface Props {
		items: ViewItem[];
		config: ListConfig<ViewItem>;
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
	const viewItemSortCache = createViewItemSortCache();
	const getViewItemKey = (item: ViewItem, index: number): string =>
		config.getItemKey(item, index);
	const virtualItemIdByItem = new WeakMap<ViewItem, string>();
	let nextVirtualItemId = 0;
	const getVirtualItemId = (item: ViewItem): string => {
		const existing = virtualItemIdByItem.get(item);
		if (existing) return existing;

		nextVirtualItemId += 1;
		const itemId = `view-item-${nextVirtualItemId}`;
		virtualItemIdByItem.set(item, itemId);
		return itemId;
	};
	const viewItemReconciler = createStableViewItemReconciler<ViewItem>({
		getKey: getViewItemKey,
		toViewItem: (item) => item,
		canReuseSource: hasSameViewItemSource,
	});

	let searchEnabled = $derived(config.searchEnabled ?? true);
	let allowContentSearch = $derived(config.allowContentSearch ?? true);
	let reconcileResetVersion = $state(0);
	let reconciledItems = $derived.by(() => {
		void reconcileResetVersion;
		return viewItemReconciler.reconcile(items);
	});

	const search = useSearchQuery();
	let contentSearchEnabled = $state(false);
	const contentSearchEnabledSetting = $derived(
		applicationStore.settings?.enableContentSearch ?? false,
	);

	function syncContentSearchToggleFromSettings(): void {
		contentSearchEnabled = contentSearchEnabledSetting;
	}

	const searchTextCache = createItemSearchTextCache();
	let previousWorkerDataset: SearchWorkerItemSnapshot[] = [];
	const workerSnapshotByKey = new Map<string, SearchWorkerItemSnapshot>();

	function clearSearchTextCacheForInputChange(): void {
		void reconciledItems;
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

	const getItemTargetFile = (item: ViewItem): TFile | null => {
		switch (item.type) {
			case "backlink":
				return item.data.sourceFile;
			case "taggedNote":
				return item.data.file;
			case "file":
				return item.data;
			case "branch":
				return item.data.hop1.path
					? linkContext.resolveFile(item.data.hop1.path)
					: null;
			default:
				return null;
		}
	};

	const getCachedItemSearchText = (item: ViewItem): string => {
		const key = config.getItemKey(item);
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
	const hasSameWorkerDataset = (
		nextDataset: readonly SearchWorkerItemSnapshot[],
		previousDataset: readonly SearchWorkerItemSnapshot[],
	): boolean =>
		sameArrayBy(
			nextDataset,
			previousDataset,
			(nextItem, previousItem) =>
				nextItem.key === previousItem.key &&
				nextItem.searchText === previousItem.searchText &&
				nextItem.targetFilePath === previousItem.targetFilePath,
		);

	const buildWorkerDataset = (): SearchWorkerItemSnapshot[] => {
		const nextDataset = new Array<SearchWorkerItemSnapshot>(reconciledItems.length);
		const nextKeys = new Set<string>();
		for (let index = 0; index < reconciledItems.length; index += 1) {
			const item = reconciledItems[index];
			const key = config.getItemKey(item);
			const targetFile = getItemTargetFile(item);
			const targetFilePath = targetFile?.path ?? null;
			const searchText = getCachedItemSearchText(item);
			const previous = workerSnapshotByKey.get(key);
			nextKeys.add(key);

			if (
				previous &&
				previous.searchText === searchText &&
				previous.targetFilePath === targetFilePath
			) {
				nextDataset[index] = previous;
				continue;
			}

			const snapshot: SearchWorkerItemSnapshot = {
				key,
				searchText,
				targetFilePath,
			};
			workerSnapshotByKey.set(key, snapshot);
			nextDataset[index] = snapshot;
		}

		for (const key of workerSnapshotByKey.keys()) {
			if (!nextKeys.has(key)) {
				workerSnapshotByKey.delete(key);
			}
		}

		if (hasSameWorkerDataset(nextDataset, previousWorkerDataset)) {
			return previousWorkerDataset;
		}

		previousWorkerDataset = nextDataset;
		return nextDataset;
	};
	const getSearchableFiles = (): TFile[] => {
		const filesByPath = new Map<string, TFile>();
		for (const item of reconciledItems) {
			const targetFile = getItemTargetFile(item);
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

	let sortedItems = $derived(
		getSortedViewItemsWithCache(
			reconciledItems,
			sortOption,
			sortSettingsSignature,
			sortService,
			viewItemSortCache,
			(raw) => toViewItem(raw),
		),
	);

	let filteredItems = $state.raw<ViewItem[]>([]);
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

			const nextItems: ViewItem[] = [];
			let lastPublish = performance.now();

			for (let index = 0; index < sourceItems.length; index += 1) {
				if (serial !== filterRunSerial) {
					return;
				}

				const item = sourceItems[index];
				if (matches.has(config.getItemKey(item))) {
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
	const cardModelCache = new WeakMap<
		ViewItem,
		{ revision: object; itemKey: string; model: CardRenderModel }
	>();
	const cardModelRevision = $derived.by(() => ({
		settings: applicationStore.settings,
		searchQuery: search.normalized,
		contentSearchEnabled,
		allowContentSearch,
		matchesByKey,
		applicationUpdateVersion: applicationStore.updateVersion,
		previewGlobalVersion: applicationStore.previewGlobalVersion,
		previewPathVersions: applicationStore.previewPathVersions,
	}));

	function resolveViewItemCardModel(
		item: ViewItem,
		index: number,
		revision = cardModelRevision,
	): CardRenderModel {
		const itemKey = config.getItemKey(item, index);
		const cached = cardModelCache.get(item);
		if (cached?.revision === revision && cached.itemKey === itemKey) {
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
				applicationStore.getPreviewRenderVersion?.(path) ?? "0:0",
			searchQuery: revision.searchQuery,
			searchScope,
			contentPreview: matchedItem?.contentPreview,
			interactionId,
		});
		cardModelCache.set(item, { revision, itemKey, model });
		return model;
	}

	const resolveItemPreviewRequest = $derived.by(() => {
		const revision = cardModelRevision;
		return (item: ViewItem, index: number) =>
			resolveViewItemCardModel(item, index, revision).previewRequest;
	});
	const resolveItemInteractionDescriptor = $derived.by(() => {
		const revision = cardModelRevision;
		return (item: ViewItem, index: number) =>
			resolveViewItemCardModel(item, index, revision).interactionDescriptor;
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
			getItemId={getVirtualItemId}
			sectionId={searchScopedSectionId}
			{applicationStore}
			{initialVisibleCount}
			{loadMoreIncrement}
			paginationMode={config.paginationMode ?? "button"}
			{resolveItemPreviewRequest}
			{resolveItemInteractionDescriptor}
			header={config.showSectionHeader ? sectionHeader : undefined}
		>
			{#snippet item({ item, index, previewKey })}
				<ViewItemCard
					model={resolveViewItemCardModel(item, index)}
					{previewKey}
				/>
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
