<script lang="ts">
	import { getContext } from "svelte";
	import TwoHopSurface from "features/two-hop/ui/TwoHopSurface.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type {
		SearchWorkerMatchedItem,
		SearchWorkerMatchScope,
	} from "features/search/searchWorkerTypes";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor,
	} from "features/two-hop/ui/twoHopVirtualListModel";
	import { useLinkContext } from "ui/context/linkContext";
	import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
	import {
		createTwoHopCardRenderModelCache,
		type TwoHopCardModelRevision,
	} from "features/two-hop/ui/twoHopCardRenderModelCache";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { LinkUtilitiesContext } from "types/linkContext";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		searchQuery?: string;
		searchScope?: SearchWorkerMatchScope;
		matchedItemByKey?: Map<string, SearchWorkerMatchedItem> | null;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		linkContext?: LinkUtilitiesContext;
		previewActive?: boolean;
	}

	let {
		sections,
		applicationStore,
		searchQuery = "",
		searchScope = "title-and-content",
		matchedItemByKey = null,
		initialVisibleCount,
		loadMoreIncrement,
		linkContext: providedLinkContext = undefined,
		previewActive = true,
	}: Props = $props();

	if (!applicationStore) {
		applicationStore = getContext<ApplicationStore>("applicationStore");
	}

	const currentSettings = $derived(applicationStore.settings);
	function resolveLinkContext(): LinkUtilitiesContext | undefined {
		if (providedLinkContext) return providedLinkContext;
		try {
			return useLinkContext();
		} catch {
			return undefined;
		}
	}
	const linkContext = resolveLinkContext();
	const cardModelCache = createTwoHopCardRenderModelCache();
	function getPreviewRenderVersion(path: string): string {
		return applicationStore.getPreviewRenderVersion(path);
	}
	const cardModelRevision = $derived.by((): TwoHopCardModelRevision | undefined =>
		linkContext
			? {
					settings: currentSettings,
					searchQuery,
					searchScope,
					matchedItemByKey,
					linkContext,
					getPreviewRenderVersion,
					applicationUpdateVersion: applicationStore.updateVersion,
					previewGlobalVersion: applicationStore.previewGlobalVersion,
					previewPathVersions: applicationStore.previewPathVersions,
				}
			: undefined,
	);
	const resolveItemCardModel = $derived.by(() => {
		const revision = cardModelRevision;
		if (!revision) return undefined;
		return (
			row: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		): CardRenderModel => cardModelCache.resolve(row, presentation, revision);
	});
</script>

<TwoHopSurface
	{sections}
	{applicationStore}
	{initialVisibleCount}
	{loadMoreIncrement}
	{resolveItemCardModel}
	{previewActive}
/>
