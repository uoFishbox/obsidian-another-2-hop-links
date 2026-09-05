<script lang="ts">
	import { MarkdownView, TFile, type App } from "obsidian";
	import { setContext } from "svelte";
	import LoadingState from "shared/ui/primitives/LoadingState.svelte";
	import ListControls from "cards/components/ListControls.svelte";
	import TwoHopVirtualGrid from "two-hop/ui/TwoHopVirtualGrid.svelte";
	import { useSearchQuery } from "cards/hooks/useSearchQuery.svelte";
	import { useBookmarks } from "cards/hooks/useBookmarks.svelte";
	import {
		useStreamingSearchSession,
		type SearchMatchSnapshot,
	} from "search/useStreamingSearchSession.svelte";
	import type { SearchMatchedItem, SearchMatchScope } from "search/searchTypes";
	import { focusResultEdge } from "cards/navigation/resultFocus";
	import {
		setLinkContext,
		type LinkContext,
		setAppContext,
		setLazyLoaderCache,
	} from "cards/context/linkContext";
	import type { CardCollectionState } from "cards/CardCollectionState.svelte";
	import type { TwoHopState } from "two-hop/state/TwoHopState.svelte";
	import type { PluginSettings } from "settings/model";
	import { getCardLayoutCssText } from "cards/layout/cardLayoutCssVars";
	import {
		buildTwoHopSearchSnapshot,
		type TwohopIncrementalSearchFilter,
		type TwohopSearchRenderMode,
	} from "two-hop/ui/twoHopSearchAdapter";
	import type { DisplayData } from "two-hop/display/displayDataBuilder";
	import { tick, untrack } from "svelte";
	import { createTwoHopSectionPublicationMemo } from "two-hop/ui/section-descriptors/cache";
	import { createTwoHopInteractionIdentity } from "two-hop/ui/section-descriptors/descriptors";
	import {
		buildScopedSectionId,
		normalizeIncrement,
	} from "cards/components/listPagination";
	import type { TwoHopLinksRootUiState } from "two-hop/ui/twoHopLinksRootUiState";
	import { observePreviewSurfaceVisibility } from "card-preview/scheduling/previewSurfaceVisibility";
	import type { TwoHopPreviewDependencies } from "two-hop/ui/virtual-grid/useTwoHopVirtualGrid.svelte";
	import type { PreviewRuntime } from "card-preview/runtime/previewRuntime";
	import type { LinkUtilitiesContext } from "cards/context/linkUtilities";
	import {
		createCardRenderModel,
		type CardRenderModel,
	} from "cards/rendering/cardRenderModel";
	import type { TwoHopItemModel } from "two-hop/ui/twoHopSectionModel";

	interface TwoHopCardModelRevision {
		readonly settings: PluginSettings;
		readonly searchQuery: string;
		readonly searchScope: "title-only" | "title-and-content";
		readonly matchesByKey: ReadonlyMap<string, SearchMatchedItem> | null;
		readonly linkContext: LinkUtilitiesContext;
		readonly getPreviewRenderVersion: (path: string) => string;
		readonly applicationUpdateVersion: number;
	}

	function buildTwoHopCardModel(
		row: TwoHopItemModel,
		revision: TwoHopCardModelRevision,
	): CardRenderModel {
		const matchedItem = revision.matchesByKey?.get(row.searchKey);
		return createCardRenderModel({
			item: row.item,
			settings: revision.settings,
			context: revision.linkContext,
			getPreviewRenderVersion: revision.getPreviewRenderVersion,
			searchQuery: revision.searchQuery,
			searchScope:
				revision.searchScope === "title-and-content" &&
				(matchedItem?.contentMatched ?? true)
					? "title-and-content"
					: "title-only",
			interactionId: row.interactionId,
		});
	}

	interface Props {
		file: TFile;
		linkContext: LinkContext;
		applicationStore: TwoHopState;
		app: App;
		previewRuntime?: PreviewRuntime;
		lazyLoaderCache: Set<string>;
		isSidebar?: boolean;
		updateSetting?: <K extends keyof PluginSettings>(
			key: K,
			value: PluginSettings[K],
		) => Promise<void>;
		uiState?: TwoHopLinksRootUiState;
	}

	interface TwoHopSearchPresentation {
		readonly result: SearchMatchSnapshot | null;
		readonly displayData: DisplayData;
		readonly renderMode: TwohopSearchRenderMode;
	}

	function clearDisplayData(): DisplayData {
		return {
			outgoing: [],
			backlinks: [],
			mergedItems: [],
			twoHopBranches: [],
			tagGroups: [],
			newLinks: [],
		};
	}

	function hasDisplayDataItems(data: DisplayData): boolean {
		return (
			data.outgoing.length > 0 ||
			data.backlinks.length > 0 ||
			data.mergedItems.length > 0 ||
			data.twoHopBranches.length > 0 ||
			data.tagGroups.length > 0 ||
			data.newLinks.length > 0
		);
	}

	let {
		file,
		linkContext,
		applicationStore,
		app,
		previewRuntime = undefined,
		lazyLoaderCache,
		isSidebar = false,
		updateSetting,
		uiState,
	}: Props = $props();
	const applicationUiState = applicationStore.uiState;

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
	let currentSettings = $derived(applicationUiState.settings);
	let useMergedLinks = $derived(currentSettings.useMergedLinksSection);
	let showTags = $derived(currentSettings.showTagsSection);
	let currentSort = $derived(applicationUiState.sortOption);
	let cardLayoutCssText = $derived(getCardLayoutCssText(currentSettings));
	let contentSearchEnabled = $state(false);
	let searchMatchScope = $derived.by(
		(): SearchMatchScope =>
			contentSearchEnabled ? "title-and-content" : "title-only",
	);

	$effect(() => {
		contentSearchEnabled = currentSettings.enableContentSearch ?? false;
	});

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
	let getSortedTwoHopItems = $derived.by(() => {
		const store = applicationStore;
		return (items: Parameters<TwoHopState["getSortedTwoHopItems"]>[0]) =>
			store.getSortedTwoHopItems(items);
	});
	let getSortedTagGroupItems = $derived.by(() => {
		const store = applicationStore;
		return (items: Parameters<TwoHopState["getSortedTagGroupItems"]>[0]) =>
			store.getSortedTagGroupItems(items);
	});
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
		getSortedTwoHopItems,
		getSortedTagGroupItems,
		priorityFrontmatterKeyForTitle: currentSettings.priorityFrontmatterKeyForTitle,
	});
	let searchSnapshot = $derived.by(() =>
		buildTwoHopSearchSnapshot(getSearchAdapterOptions()),
	);
	const searchSession = useStreamingSearchSession({
		app,
		query: () => search.normalized,
		enabled: () => !!search.normalized,
		matchScope: () => searchMatchScope,
		buildSnapshot: () => searchSnapshot,
	});
	let isSearchLoading = $derived(searchSession.isPending);
	let searchPresentation = $state.raw<TwoHopSearchPresentation>({
		result: null,
		displayData: untrack(() => displayData),
		renderMode: untrack(getSearchRenderMode),
	});
	let incrementalSearchRun: {
		readonly requestId: number;
		readonly displayData: DisplayData;
		readonly renderMode: TwohopSearchRenderMode;
		readonly filter: TwohopIncrementalSearchFilter;
		consumedMatchCount: number;
	} | null = null;

	$effect(() => {
		const currentDisplayData = displayData;
		const renderMode = getSearchRenderMode();
		if (!search.normalized) {
			incrementalSearchRun = null;
			searchPresentation = {
				result: null,
				displayData: currentDisplayData,
				renderMode,
			};
			return;
		}

		const visibleResult = searchSession.visibleResult;
		if (visibleResult?.type === "stale") return;
		const result = visibleResult?.result ?? null;
		if (!result) {
			if (
				searchPresentation.result !== null ||
				hasDisplayDataItems(searchPresentation.displayData)
			) {
				searchPresentation = {
					result: null,
					displayData: clearDisplayData(),
					renderMode,
				};
			}
			return;
		}
		const continuesCurrentRun =
			incrementalSearchRun?.requestId === result.requestId &&
			incrementalSearchRun.displayData === currentDisplayData &&
			incrementalSearchRun.renderMode.useMergedLinks ===
				renderMode.useMergedLinks &&
			incrementalSearchRun.renderMode.showTags === renderMode.showTags;
		if (!continuesCurrentRun) {
			incrementalSearchRun = {
				requestId: result.requestId,
				displayData: currentDisplayData,
				renderMode,
				filter: searchSnapshot.createIncrementalFilter(),
				consumedMatchCount: 0,
			};
		}
		const run = incrementalSearchRun;
		if (!run) return;
		const addedMatches = result.orderedMatches.slice(run.consumedMatchCount);
		run.consumedMatchCount = result.orderedMatches.length;
		const filtered = run.filter.append(addedMatches);
		searchPresentation = { result, displayData: filtered, renderMode };
	});

	let appliedSearchQuery = $derived(searchPresentation.result?.query ?? "");
	let appliedSearchScope = $derived(searchPresentation.result?.scope ?? "title-only");
	let paginationScope = $derived(
		JSON.stringify([
			file.path,
			searchPresentation.result?.query ?? "",
			searchPresentation.result?.scope ?? "none",
		]),
	);

	let filteredDisplayData = $derived(searchPresentation.displayData);
	const sourceFile = linkContext.sourceFile;
	const fileToLinktext = linkContext.fileToLinktext;
	const onTagClick = linkContext.onTagClick;
	const interactionIdentity = createTwoHopInteractionIdentity();
	const sectionPublicationMemo = createTwoHopSectionPublicationMemo();
	let getSectionVisibleCount = $derived.by(() => {
		const expandedLimits = applicationUiState.sectionExpandedLimits ?? {};
		const requestedDefaultLimit = Math.floor(
			currentSettings.defaultVisibleLinkCount,
		);
		const defaultLimit = Number.isFinite(requestedDefaultLimit)
			? Math.max(0, requestedDefaultLimit)
			: 0;
		return (sectionId: string, totalCount: number): number => {
			const paginationId = buildScopedSectionId(sectionId, paginationScope);
			const requestedExpandedLimit = Math.floor(
				expandedLimits[paginationId] ?? 0,
			);
			const expandedLimit = Number.isFinite(requestedExpandedLimit)
				? Math.max(0, requestedExpandedLimit)
				: 0;
			return Math.min(totalCount, Math.max(defaultLimit, expandedLimit));
		};
	});
	const twoHopVirtualListSections = $derived.by(() =>
		sectionPublicationMemo.resolve({
			displayData: filteredDisplayData,
			useMergedLinks: searchPresentation.renderMode.useMergedLinks,
			showTags: searchPresentation.renderMode.showTags,
			sourceFile,
			resolveFile: linkContext.resolveFile,
			fileToLinktext,
			currentSort,
			currentSettings,
			sortContextVersion: applicationStore.getSortContextVersion?.() ?? 0,
			getSortedTwoHopItems,
			getSortedTagGroupItems,
			getVisibleCount: getSectionVisibleCount,
			interactionIdentity,
			onTagClick,
		}),
	);
	function loadMoreSection(sectionId: string): void {
		const section = twoHopVirtualListSections.find(
			(candidate) => candidate.id === sectionId,
		);
		if (!section) return;

		const visibleCount = getSectionVisibleCount(sectionId, section.totalCount);
		if (visibleCount >= section.totalCount) return;

		const increment = normalizeIncrement(applicationUiState.loadMoreIncrement);
		const nextCount =
			increment === Number.POSITIVE_INFINITY
				? section.totalCount
				: Math.min(section.totalCount, visibleCount + increment);
		const paginationId = buildScopedSectionId(sectionId, paginationScope);
		applicationUiState.setSectionExpandedLimit(
			paginationId,
			Math.max(
				applicationUiState.getSectionExpandedLimit(paginationId) ?? 0,
				nextCount,
			),
		);
	}

	setAppContext({
		linkContext,
		applicationStore: applicationUiState,
		app,
		previewRuntime,
		bookmarks,
		resolveSearchMatchPosition: (query, targetFile) =>
			searchSession.resolveFirstMatchPosition(query, targetFile),
		resolveSearchMatchOffset: (query, targetFile) =>
			searchSession.getFirstMatchOffset(query, targetFile),
		updateSetting,
	});

	setLinkContext(linkContext);
	setContext<CardCollectionState>("applicationStore", applicationUiState);
	setLazyLoaderCache(lazyLoaderCache);

	const previewDependencies: TwoHopPreviewDependencies | undefined = previewRuntime
		? {
				previewRuntime,
				resolveSearchMatchOffset: (query, targetFile) =>
					searchSession.getFirstMatchOffset(query, targetFile),
			}
		: undefined;

	function getPreviewRenderVersion(path: string): string {
		return applicationUiState.previewState.getRenderVersion(path);
	}

	const cardModelRevision = $derived.by(
		(): TwoHopCardModelRevision => ({
			settings: currentSettings,
			searchQuery: appliedSearchQuery,
			searchScope: appliedSearchScope,
			matchesByKey: searchPresentation.result?.matchesByKey ?? null,
			linkContext,
			getPreviewRenderVersion,
			applicationUpdateVersion: applicationUiState.updateVersion,
		}),
	);
	const resolveItemCardModel = (
		item: Parameters<typeof buildTwoHopCardModel>[0],
		revision: unknown,
	) => buildTwoHopCardModel(item, revision as TwoHopCardModelRevision);

	let rootEl = $state<HTMLDivElement | null>(null);
	let previewSurfaceActive = $state(false);
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
				applicationUiState.setContentSearchEnabled(newValue);
			}}
			{contentSearchEnabled}
			sortOption={currentSort}
			allowRelevanceSort={true}
			onSortChange={(opt) => applicationUiState.setSortOption(opt)}
			onMoveFocusToResults={moveFocusToResults}
		/>
	{/if}
	<div
		class="cosense-card-links__results cosense-card-links__search-result-container"
		class:ccl-search-pending={isSearchLoading}
		aria-busy={isSearchLoading}
		bind:this={resultsContainerEl}
		style:min-height={resultsMinHeight}
	>
		{#if loading}
			<LoadingState message="Waiting for the initial index to finish building." />
		{:else if linkResult}
			<TwoHopVirtualGrid
				sections={twoHopVirtualListSections}
				applicationStore={applicationUiState}
				{loadMoreSection}
				{cardModelRevision}
				{resolveItemCardModel}
				{previewDependencies}
				previewActive={previewSurfaceActive}
			/>
			{#if isSearchLoading}
				<div class="cosense-card-links__search-status" aria-live="polite">
					Searching…
				</div>
			{:else if search.normalized && searchSession.phase === "ready" && twoHopVirtualListSections.length === 0}
				<div class="modal-empty">No matches found.</div>
			{/if}
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

	.cosense-card-links__search-status {
		padding: 6px 12px;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
	}

	.modal-empty {
		padding: 40px 20px;
		text-align: center;
		color: var(--text-muted);
	}
</style>
