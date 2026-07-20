<script lang="ts">
	import { onDestroy } from "svelte";
	import ViewItemCard from "../ViewItemCard.svelte";
	import PreviewVisibilityProvider from "features/preview/ui/PreviewVisibilityProvider.svelte";
	import { setAppContext, setLinkContext } from "ui/context/linkContext";
	import { providePreviewActivationContexts } from "features/preview/scheduling/previewActivationContexts";
	import { DEFAULT_SETTINGS } from "features/settings/model";
	import type { PluginSettings } from "features/settings/model";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { BookmarksState, LinkContext } from "ui/context/linkContext";
	import type { App, TFile } from "obsidian";
	import type { ViewItem } from "application/presenters";
	import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";
	import type { CardRenderModel } from "../cardRenderModel";
	import {
		createCardPreviewSnapshot,
		createCardRenderModel,
	} from "../cardRenderModel";
	import { createRowPreviewController } from "features/preview/scheduling/rowPreviewController.svelte";
	import type { CardPreviewSlotState } from "features/preview/ui/cardPreviewSnapshot";

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
		visibility = undefined,
		previewRefreshToken = 0,
		bookmarks = {
			filePaths: new Set<string>(),
			orderedFilePaths: [],
			isBookmarked: () => false,
		},
		model = undefined,
	}: Props = $props();
	const rowIndex = 0;
	const activationCandidateId = "view-item-card-harness";
	const activationContexts = providePreviewActivationContexts();
	const previewController = createRowPreviewController({
		runtime: activationContexts.rowPreviewActivationRuntime,
		scope: activationContexts.previewActivationScope,
		getQueuedPreviewJobs: linkContext.getVisiblePreviewQueueSize,
		getActivePreviewJobs: linkContext.getActiveVisiblePreviewCount,
	});
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
	let previewState = $state.raw<CardPreviewSlotState | undefined>(undefined);

	$effect(() => {
		const snapshot = effectiveModel
			? createCardPreviewSnapshot(effectiveModel)
			: null;
		previewController.syncCards(
			snapshot ? [{ slotId: activationCandidateId, rowIndex, snapshot }] : [],
		);
		previewState = previewController.getSlotState(activationCandidateId);
	});

	$effect(() => {
		activationContexts.rowPreviewActivationRuntime.setRowVisibility(
			rowIndex,
			visibility === "visible" ? "visible" : "mounted",
		);
	});

	onDestroy(() => {
		previewController.dispose();
	});
</script>

<PreviewVisibilityProvider {visibility}>
	<ViewItemCard
		{item}
		{settings}
		{searchQuery}
		{previewRefreshToken}
		model={effectiveModel}
		{previewState}
	/>
</PreviewVisibilityProvider>
