<script lang="ts">
	import ViewItemCard from "../ViewItemCard.svelte";
	import PreviewVisibilityProvider from "../PreviewVisibilityProvider.svelte";
	import { setAppContext, setLinkContext } from "ui/context/linkContext";
	import { DEFAULT_SETTINGS } from "types/settings";
	import type { PluginSettings } from "types/settings";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { BookmarksState, LinkContext } from "ui/context/linkContext";
	import type { App, TFile } from "obsidian";
	import type { ViewItem } from "application/presenters";
	import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";

	interface Props {
		item: ViewItem | undefined;
		searchQuery?: string;
		linkContext: LinkContext;
		applicationStore: ApplicationStore;
		sourceFile: TFile;
		app?: App;
		settings?: PluginSettings;
		visibility?: VirtualizedItemVisibility;
		previewRefreshToken?: number;
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
		visibility = undefined,
		previewRefreshToken = 0,
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

	setAppContext({
		linkContext: scopedLinkContext,
		applicationStore,
		app,
		bookmarks,
	});
</script>

<PreviewVisibilityProvider {visibility}>
	<ViewItemCard {item} {settings} {searchQuery} {previewRefreshToken} />
</PreviewVisibilityProvider>
