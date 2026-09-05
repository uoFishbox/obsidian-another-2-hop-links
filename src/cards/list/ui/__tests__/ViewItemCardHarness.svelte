<script lang="ts">
	import ViewItemCard from "../ViewItemCard.svelte";
	import { setAppContext, setLinkContext } from "cards/context/linkContext";
	import { DEFAULT_SETTINGS } from "settings/model";
	import type { PluginSettings } from "settings/model";
	import type { CardCollectionState } from "cards/CardCollectionState.svelte";
	import type { BookmarksState, LinkContext } from "cards/context/linkContext";
	import type { App, TFile } from "obsidian";
	import type { CardItem } from "cards/CardItem";
	import type { CardRenderModel } from "cards/rendering/cardRenderModel";
	import { createCardRenderModel } from "cards/rendering/cardRenderModel";
	import { createInteractionHandle } from "cards/interactions/interactionTypes";

	interface Props {
		item: CardItem | undefined;
		searchQuery?: string;
		linkContext: LinkContext;
		applicationStore: CardCollectionState;
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
							applicationStore.previewState.getRenderVersion(path),
						searchQuery,
					})
				: undefined),
	);
	const interactionHandle = createInteractionHandle("t");
</script>

<ViewItemCard model={effectiveModel} {interactionHandle} />
