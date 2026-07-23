<script lang="ts">
	import ViewItemCard from "../ViewItemCard.svelte";
	import { setAppContext, setLinkContext } from "ui/context/linkContext";
	import { DEFAULT_SETTINGS } from "features/settings/model";
	import type { PluginSettings } from "features/settings/model";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { BookmarksState, LinkContext } from "ui/context/linkContext";
	import type { App, TFile } from "obsidian";
	import type { ViewItem } from "application/presenters";
	import type { CardRenderModel } from "../cardRenderModel";
	import { createCardRenderModel } from "../cardRenderModel";

	interface Props {
		item: ViewItem | undefined;
		searchQuery?: string;
		linkContext: LinkContext;
		applicationStore: ApplicationStore;
		sourceFile: TFile;
		app?: App;
		settings?: PluginSettings;
		previewRefreshToken?: number;
		bookmarks?: BookmarksState;
		model?: CardRenderModel;
	}

	let {
		item,
		searchQuery = "",
		linkContext,
		applicationStore,
		sourceFile,
		app = {} as App,
		settings = DEFAULT_SETTINGS,
		previewRefreshToken = 0,
		bookmarks = {
			filePaths: new Set<string>(),
			orderedFilePaths: [],
			isBookmarked: () => false,
		},
		model = undefined,
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
	const effectiveModel = $derived.by(
		() =>
			model ??
			(item
				? createCardRenderModel({
						item,
						settings,
						context: scopedLinkContext,
						getPreviewRenderVersion: (path) =>
							applicationStore.getPreviewRenderVersion?.(path) ?? "0:0",
						searchQuery,
						previewRefreshToken,
					})
				: undefined),
	);
</script>

<ViewItemCard
	{item}
	{settings}
	{searchQuery}
	{previewRefreshToken}
	model={effectiveModel}
/>
