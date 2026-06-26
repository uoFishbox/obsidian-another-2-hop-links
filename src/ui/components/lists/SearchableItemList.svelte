<script lang="ts">
	import { setContext } from "svelte";
	import PreviewVisibilityProvider from "ui/components/items/PreviewVisibilityProvider.svelte";
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import ListControls from "ui/components/common/ListControls.svelte";
	import LinkList from "ui/components/common/VirtualGridLinkList.svelte";
	import LinkSectionHeader from "ui/components/common/LinkSectionHeader.svelte";
	import type { MountedVirtualGridCell } from "ui/components/common/virtual-list/reconciliation/linkListVirtualLayout";
	import { buildScopedSectionId } from "ui/components/common/listPagination";
	import { useSearchQuery } from "ui/hooks/useSearchQuery.svelte";
	import { useBookmarks } from "ui/hooks/useBookmarks.svelte";
	import { useWorkerSearchSession } from "features/search/useWorkerSearchSession.svelte";
	import { focusResultEdge } from "features/keyboard-navigation/resultFocus";
	import type { ListConfig } from "ui/components/lists/types";
	import { hasSameViewItemSource } from "ui/utils/twohopEquality";
	import { sameArrayBy } from "utils/arrayEquality";
	import {
		setLinkContext,
		type LinkContext,
		setAppContext,
		setLazyLoaderCache,
	} from "ui/context/linkContext";
	import type { SortOption } from "types/settings";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { ISortService } from "types/services";
	import type { App, TFile } from "obsidian";
	import {
		createStableViewItemReconciler,
		type ViewItem,
		toViewItem,
	} from "application/presenters";
	import { createItemSearchTextCache, getItemSearchText } from "./itemSearchText";
	import { buildSearchWorkerItemSnapshot } from "features/search/searchSnapshotBuilders";
	import type { SearchWorkerItemSnapshot } from "features/search/searchWorkerTypes";
	import {
		createViewItemSortCache,
		getSortedViewItemsWithCache,
		pinBookmarkedViewItems,
	} from "./searchableItemSorting";
	import { tick } from "svelte";

	interface Props {
		items: ViewItem[];
		config: ListConfig<ViewItem>;
		linkContext: LinkContext;
		applicationStore: ApplicationStore;
		sortService: ISortService;
		app: App;
		autofocus?: boolean;
		previewRefreshTokens?: Record<string, number>;
	}

	let {
		items,
		config,
		linkContext,
		applicationStore,
		sortService,
		app,
		autofocus = true,
		previewRefreshTokens = {},
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

	const handleMountedCellsChange = (
		_cells: readonly MountedVirtualGridCell<ViewItem>[],
	): void => {};

	// フックを利用
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
		for (let index = 0; index < reconciledItems.length; index += 1) {
			const item = reconciledItems[index];
			const targetFile = getItemTargetFile(item);
			nextDataset[index] = buildSearchWorkerItemSnapshot(
				config.getItemKey(item),
				getCachedItemSearchText(item),
				targetFile?.path ?? null,
			);
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
	setContext<ApplicationStore>("applicationStore", applicationStore);
	const bookmarks = useBookmarks(app);
	const workerSearchSession = useWorkerSearchSession({
		app,
		query: () => search.normalized,
		enabled: () => searchEnabled && !!search.normalized,
		matchScope: () =>
			allowContentSearch && contentSearchEnabled
				? "title-and-content"
				: "title-only",
		contentSyncMode: "progressive",
		progressiveSyncIntervalMs: 400,
		getSearchableFiles,
		buildDataset: buildWorkerDataset,
		contentSearchBackend: () =>
			applicationStore.settings?.enableRipgrepContentSearch
				? "ripgrep"
				: "worker",
		ripgrepExecutablePath: () =>
			applicationStore.settings?.ripgrepExecutablePath || undefined,
	});

	setAppContext({
		linkContext,
		applicationStore,
		app,
		bookmarks,
		resolveSearchMatchPosition: (query, file) =>
			workerSearchSession.getFirstMatchPosition(query, file),
	});
	const lazyLoaderCache = new Set<string>();
	setLazyLoaderCache(lazyLoaderCache);
	let matchedKeySet = $derived(workerSearchSession.matchedKeySet);
	let matchedItemByKey = $derived(workerSearchSession.matchedItemByKey);
	let isSearchLoading = $derived(workerSearchSession.isLoading);

	// ソートは検索語ではなく items / sortOption の変化だけで再実行する
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

	let filteredItems = $derived.by(() => {
		let result: ViewItem[];
		if (!searchEnabled) {
			result = sortedItems;
		} else {
			const query = search.normalized;
			if (!query) {
				result = sortedItems;
			} else if (!matchedKeySet) {
				result = [];
			} else {
				const nextItems: ViewItem[] = [];
				for (const item of sortedItems) {
					const key = config.getItemKey(item);
					if (matchedKeySet.has(key)) {
						nextItems.push(item);
					}
				}
				result = nextItems;
			}
		}

		if (config.pinBookmarkedToTop) {
			result = pinBookmarkedViewItems(result, bookmarks);
		}

		return result;
	});

	let initialVisibleCount = $derived(applicationStore.initialVisibleCount);
	let searchScopedSectionId = $derived(
		buildScopedSectionId(config.sectionId, search.normalized),
	);
	let loadMoreIncrement = $derived(applicationStore.loadMoreIncrement);
	let preserveResultsHeightOnSearch = $derived(
		config.preserveResultsHeightOnSearch ?? true,
	);
	let shouldPassVisibilityProp = $derived(config.itemComponent !== ViewItemCard);

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
			getKey={getViewItemKey}
			sectionId={searchScopedSectionId}
			{applicationStore}
			{initialVisibleCount}
			{loadMoreIncrement}
			paginationMode={config.paginationMode ?? "button"}
			onMountedCellsChange={handleMountedCellsChange}
			header={config.showSectionHeader ? sectionHeader : undefined}
		>
			{#snippet item({
				item,
				observerRoot,
				visibility,
				visibilityState,
				rowIndex,
				activationCandidateId,
			})}
				{@const ItemComponent = config.itemComponent}
				{@const previewRefreshToken =
					previewRefreshTokens[config.getItemKey(item)] ?? 0}
				{@const renderedItemKey = config.getItemKey(item)}
				{@const matchedItem = matchedItemByKey?.get(renderedItemKey) ?? null}
				{#if shouldPassVisibilityProp}
					<ItemComponent
						{...config.getItemProps(item)}
						searchQuery={search.normalized}
						searchScope={allowContentSearch &&
						contentSearchEnabled &&
						(matchedItem?.contentMatched ?? true)
							? "title-and-content"
							: "title-only"}
						contentPreview={matchedItem?.contentPreview}
						{observerRoot}
						{visibility}
						{previewRefreshToken}
						{rowIndex}
						{activationCandidateId}
					/>
				{:else}
					<PreviewVisibilityProvider {visibilityState}>
						<ItemComponent
							{...config.getItemProps(item)}
							searchQuery={search.normalized}
							searchScope={allowContentSearch &&
							contentSearchEnabled &&
							(matchedItem?.contentMatched ?? true)
								? "title-and-content"
								: "title-only"}
							contentPreview={matchedItem?.contentPreview}
							{previewRefreshToken}
							{rowIndex}
							{activationCandidateId}
						/>
					</PreviewVisibilityProvider>
				{/if}
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
