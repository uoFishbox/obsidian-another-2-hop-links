<script lang="ts">
	import ViewItemCard from "../ViewItemCard.svelte";
	import PreviewVisibilityProvider from "../PreviewVisibilityProvider.svelte";
	import {
		setAppContext,
		setLinkContext,
		setLazyLoaderCache,
	} from "ui/context/linkContext";
	import { DEFAULT_SETTINGS } from "types/settings";
	import type { PluginSettings } from "types/settings";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { BookmarksState, LinkContext } from "ui/context/linkContext";
	import type { App, TFile } from "obsidian";
	import type { ViewItem } from "application/presenters";
	import type { PreviewVisibilityMode } from "../types";
	import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";

	interface Props {
		item: ViewItem | undefined;
		searchQuery?: string;
		linkContext: LinkContext;
		applicationStore: ApplicationStore;
		sourceFile: TFile;
		app?: App;
		settings?: PluginSettings;
		previewVisibilityMode?: PreviewVisibilityMode;
		visibility?: VirtualizedItemVisibility;
		previewRefreshToken?: number;
		lazyLoaderCache?: Set<string>;
		bookmarks?: BookmarksState;
	}

	let {
		item,
		searchQuery = "",
		linkContext,
		applicationStore,
		sourceFile,
		app = {} as App,
		settings = DEFAULT_SETTINGS,
		previewVisibilityMode = undefined,
		visibility = undefined,
		previewRefreshToken = 0,
		lazyLoaderCache = new Set<string>(),
		bookmarks = {
			filePaths: new Set<string>(),
			orderedFilePaths: [],
			isBookmarked: () => false,
		},
	}: Props = $props();
	const scopedLinkContext = {
		...linkContext,
		sourceFile,
	};

	setLinkContext(scopedLinkContext);
	setLazyLoaderCache(lazyLoaderCache);

	setAppContext({
		linkContext: scopedLinkContext,
		applicationStore,
		app,
		bookmarks,
	});
</script>

<PreviewVisibilityProvider {visibility}>
	<ViewItemCard
		{item}
		{settings}
		{searchQuery}
		{previewVisibilityMode}
		{previewRefreshToken}
	/>
</PreviewVisibilityProvider>
