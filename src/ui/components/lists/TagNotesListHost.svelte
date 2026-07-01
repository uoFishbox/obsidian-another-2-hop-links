<script lang="ts">
	import type { App } from "obsidian";
	import SearchableItemList from "ui/components/lists/SearchableItemList.svelte";
	import type { ListConfig } from "ui/components/lists/types";
	import type { LinkContext } from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { ISortService } from "types/services";
	import type { ViewItem } from "application/presenters";

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

	let currentItems = $state.raw<ViewItem[]>(items);
	let currentPreviewRefreshTokens =
		$state.raw<Record<string, number>>(previewRefreshTokens);

	function syncItemsFromProps(): void {
		currentItems = items;
	}

	function syncPreviewRefreshTokensFromProps(): void {
		currentPreviewRefreshTokens = previewRefreshTokens;
	}

	$effect(() => {
		syncItemsFromProps();
	});

	$effect(() => {
		syncPreviewRefreshTokensFromProps();
	});

	export function updateItems(
		nextItems: ViewItem[],
		nextPreviewRefreshTokens: Record<string, number> = {},
	): void {
		currentItems = nextItems;
		currentPreviewRefreshTokens = nextPreviewRefreshTokens;
	}
</script>

<SearchableItemList
	items={currentItems}
	{config}
	{linkContext}
	{applicationStore}
	{sortService}
	{app}
	{autofocus}
	previewRefreshTokens={currentPreviewRefreshTokens}
/>
