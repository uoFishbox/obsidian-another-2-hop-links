<script lang="ts">
	import { MarkdownView, TFile, type App } from "obsidian";
	import { setContext } from "svelte";
	import LoadingState from "ui/components/common/LoadingState.svelte";
	import ListControls from "ui/components/common/ListControls.svelte";
	import TwoHopPageVirtualList from "./TwoHopLinksVirtualList.svelte";
	import { useSearchQuery } from "ui/hooks/useSearchQuery.svelte";
	import { useBookmarks } from "ui/hooks/useBookmarks.svelte";
	import { useWorkerSearchSession } from "features/search/useWorkerSearchSession.svelte";
	import type { SearchWorkerMatchScope } from "features/search/searchWorkerTypes";
	import { focusResultEdge } from "features/keyboard-navigation/resultFocus";
	import {
		setLinkContext,
		type LinkContext,
		setAppContext,
		setLazyLoaderCache,
	} from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import { getCardLayoutCssText } from "ui/shared/layout/cardLayoutCssVars";
	import { createTwohopSearchAdapter } from "features/two-hop/ui/twoHopSearchAdapter";
	import { tick } from "svelte";
	import { createTwoHopSectionDescriptorIdentityCache } from "features/two-hop/ui/section-descriptors/cache";
	import type { TwoHopLinksRootUiState } from "features/two-hop/ui/twoHopLinksRootUiState";
	import { observePreviewSurfaceVisibility } from "features/preview/scheduling/previewSurfaceVisibility";

	interface Props {
		file: TFile;
		linkContext: LinkContext;
		applicationStore: ApplicationStore;
		app: App;
		lazyLoaderCache: Set<string>;
		isSidebar?: boolean;
		updateSetting?: <K extends string>(key: K, value: unknown) => Promise<void>;
		uiState?: TwoHopLinksRootUiState;
	}

	let {
		file,
		linkContext,
		applicationStore,
		app,
		lazyLoaderCache,
		isSidebar = false,
		updateSetting,
		uiState,
	}: Props = $props();

	let loading = $derived(applicationStore.loading);
	let loadingPhase = $derived(applicationStore.loadingPhase);
	let linkResult = $derived(applicationStore.data);
	let displayState = $derived(applicationStore.displayState);
	let displayData = $derived(displayState.displayData);
	let hasDisplayableItems = $derived(
		loadingPhase !== "initial" && displayState.hasDisplayableItems,
	);
	let showTwoHopPlaceholder = $derived(
		loadingPhase === "base-ready" && (linkResult?.branches.length ?? 0) > 0,
	);
	let initialVisibleCount = $derived(applicationStore.initialVisibleCount);
	let loadMoreIncrement = $derived(applicationStore.loadMoreIncrement);
	let currentSettings = $derived(applicationStore.settings);
	let useMergedLinks = $derived(currentSettings.useMergedLinksSection);
	let showTags = $derived(currentSettings.showTagsSection);
	let currentSort = $derived(applicationStore.sortOption);
	let cardLayoutCssText = $derived(getCardLayoutCssText(currentSettings));
	let contentSearchEnabled = $state(false);

	$effect(() => {
		contentSearchEnabled = currentSettings.enableContentSearch ?? false;
	});

	let searchScope: SearchWorkerMatchScope = $derived(
		contentSearchEnabled ? "title-and-content" : "title-only",
	);

	// フックを利用
	const search = useSearchQuery({
		initialValue: uiState?.searchInputValue,
		onInputChange: (value) => {
			if (uiState) {
				uiState.searchInputValue = value;
			}
		},
	});
	const bookmarks = useBookmarks(app);
	const searchAdapter = createTwohopSearchAdapter();
	const getSearchRenderMode = () => ({
		useMergedLinks,
		showTags,
	});
	const getSearchAdapterOptions = () => ({
		displayData,
		renderMode: getSearchRenderMode(),
		resolveFile: linkContext.resolveFile,
		fileToLinktext: linkContext.fileToLinktext,
		sourcePath: file.path,
		getMetadata: linkContext.getMetadata,
		priorityFrontmatterKeyForTitle: currentSettings.priorityFrontmatterKeyForTitle,
	});
	let searchSnapshot = $derived.by(() =>
		searchAdapter.buildSnapshot(getSearchAdapterOptions()),
	);
	const workerSearchSession = useWorkerSearchSession({
		app,
		query: () => search.normalized,
		enabled: () => !!search.normalized,
		matchScope: () => (contentSearchEnabled ? "title-and-content" : "title-only"),
		contentSyncMode: "progressive",
		progressiveSyncIntervalMs: 400,
		getSearchableFiles: () => searchSnapshot.searchableFiles,
		buildDataset: () => searchSnapshot.workerItems,
		contentSearchBackend: () =>
			currentSettings.enableRipgrepContentSearch ? "ripgrep" : "worker",
		ripgrepExecutablePath: () => currentSettings.ripgrepExecutablePath || undefined,
	});
	let isSearchLoading = $derived(workerSearchSession.isLoading);
	let matchedKeySet = $derived(workerSearchSession.matchedKeySet);
	let matchedItemByKey = $derived(workerSearchSession.matchedItemByKey);
	let appliedSearchQuery = $derived(
		matchedKeySet === null ? search.normalized : workerSearchSession.matchedQuery,
	);
	let appliedSearchScope = $derived(
		matchedKeySet === null ? searchScope : workerSearchSession.matchedScope,
	);

	let filteredDisplayData = $derived.by(() => {
		return searchAdapter.filterDisplayData(
			displayData,
			appliedSearchQuery,
			matchedKeySet,
			getSearchRenderMode(),
		);
	});
	const sourceFile = linkContext.sourceFile;
	const fileToLinktext = linkContext.fileToLinktext;
	const onTagClick = linkContext.onTagClick;
	const sectionPublicationCache = createTwoHopSectionDescriptorIdentityCache();
	const twoHopVirtualListSections = $derived.by(() =>
		sectionPublicationCache.resolve({
			displayData: filteredDisplayData,
			useMergedLinks,
			showTags,
			sourceFile,
			resolveFile: linkContext.resolveFile,
			fileToLinktext,
			currentSort,
			currentSettings,
			applicationStore,
			onTagClick,
		}),
	);

	setAppContext({
		linkContext,
		applicationStore,
		app,
		bookmarks,
		resolveSearchMatchPosition: (query, targetFile) =>
			workerSearchSession.getFirstMatchPosition(query, targetFile),
		updateSetting,
	});

	setLinkContext(linkContext);
	setContext<ApplicationStore>("applicationStore", applicationStore);
	setLazyLoaderCache(lazyLoaderCache);

	let rootEl = $state<HTMLDivElement | null>(null);
	let previewSurfaceActive = $state(true);
	let resultsContainerEl = $state<HTMLDivElement | null>(null);
	let resultsMinHeight = $derived(search.normalized ? "100vh" : null);

	$effect(() => {
		const element = rootEl;
		if (!element) return;

		return observePreviewSurfaceVisibility(element, (active) => {
			previewSurfaceActive = active;
		});
	});

	type EditorWithCm = {
		cm?: {
			state: {
				doc: {
					length: number;
				};
			};
			dispatch: (transaction: {
				selection: {
					anchor: number;
				};
				scrollIntoView?: boolean;
			}) => void;
			focus: () => void;
		};
	};

	function focusActiveEditorToBottom(app: App): boolean {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.getMode() !== "source") {
			return false;
		}

		const inlineRoot = view.containerEl.querySelector<HTMLElement>(
			'.cosense-card-links__root[data-ccl-card-surface="inline"]',
		);
		if (!inlineRoot) {
			return false;
		}

		const cm = (view.editor as EditorWithCm | undefined)?.cm;
		if (!cm) {
			return false;
		}

		const pos = cm.state.doc.length;
		cm.dispatch({
			selection: {
				anchor: pos,
			},
			scrollIntoView: true,
		});
		cm.focus();
		return true;
	}

	async function moveFocusToResults(direction: "up" | "down") {
		await tick();

		if (
			direction === "up" &&
			!isSidebar &&
			currentSettings.enableSearchArrowUpToEditorBottom
		) {
			focusActiveEditorToBottom(app);
			return;
		}

		focusResultEdge(resultsContainerEl, direction);
	}
</script>

<div
	bind:this={rootEl}
	class="cosense-card-links__root"
	data-ccl-card-surface={isSidebar ? "sidebar" : "inline"}
	tabindex="-1"
	style={cardLayoutCssText}
>
	{#if isSidebar}
		<div class="cosense-card-links__sidebar-header">
			<span class="cosense-card-links__sidebar-header-filename" title={file.path}
				>{file.basename}</span
			>
			{#if file.extension !== "md"}
				<span
					class="cosense-card-links__sidebar-header-filename-extension nav-file-tag"
					title={file.path}>{file.extension.toUpperCase()}</span
				>
			{/if}
		</div>
	{/if}
	{#if loadingPhase !== "initial" && linkResult && hasDisplayableItems}
		<ListControls
			searchInputValue={search.value}
			onSearchInput={(value) => (search.value = value)}
			onToggleContentSearch={() => {
				const newValue = !contentSearchEnabled;
				contentSearchEnabled = newValue;
				applicationStore.setContentSearchEnabled(newValue);
			}}
			{contentSearchEnabled}
			sortOption={currentSort}
			onSortChange={(opt) => applicationStore.setSortOption(opt)}
			onMoveFocusToResults={moveFocusToResults}
		/>
	{/if}
	<div
		class="cosense-card-links__results cosense-card-links__search-result-container"
		class:is-loading={isSearchLoading}
		bind:this={resultsContainerEl}
		style:min-height={resultsMinHeight}
	>
		{#if loading}
			<LoadingState message="Waiting for the initial index to finish building." />
		{:else if linkResult}
			<TwoHopPageVirtualList
				sections={twoHopVirtualListSections}
				{applicationStore}
				searchQuery={appliedSearchQuery}
				searchScope={appliedSearchScope}
				{matchedItemByKey}
				{initialVisibleCount}
				{loadMoreIncrement}
				{linkContext}
				previewActive={previewSurfaceActive}
			/>
			{#if !filteredDisplayData.twoHopBranches.length && showTwoHopPlaceholder}
				<div class="cosense-card-links__phase-placeholder">
					<LoadingState message="Loading two-hop links..." />
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.cosense-card-links__sidebar-header {
		padding: 10px 12px;
		font-size: var(--font-ui-small);
		font-weight: 600;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: clip;
		text-overflow: ellipsis;
	}

	.cosense-card-links__phase-placeholder {
		padding: 12px 0 4px;
	}

	.cosense-card-links__search-result-container {
		overflow-anchor: none;
	}
</style>
