<script lang="ts">
	import ViewItemCard from "../ViewItemCard.svelte";
	import { setAppContext, setLinkContext } from "ui/context/linkContext";
	import { DEFAULT_SETTINGS } from "features/settings/model";
	import type { PluginSettings } from "features/settings/model";
	import type { ApplicationUiState } from "application/stores/ApplicationUiState.svelte";
	import type { BookmarksState, LinkContext } from "ui/context/linkContext";
	import type { App, TFile } from "obsidian";
	import type { ViewItem } from "application/presenters";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import { createCardRenderModel } from "ui/components/items/cardRenderModel";

	interface Props {
		item: ViewItem | undefined;
		searchQuery?: string;
		linkContext: LinkContext;
		applicationStore: ApplicationUiState;
		sourceFile: TFile;
		app?: App;
		settings?: PluginSettings;
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
					})
				: undefined),
	);
</script>

<ViewItemCard model={effectiveModel} />
