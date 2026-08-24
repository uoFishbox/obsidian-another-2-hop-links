<script lang="ts">
	import type { App } from "obsidian";
	import SearchableItemList from "./SearchableItemList.svelte";
	import type { ListConfig } from "./types";
	import type { LinkContext } from "cards/context/linkContext";
	import type { ListViewState } from "cards/list/model/ListViewState";
	import type { ISortService } from "cards/sorting";
	import type { CardItem } from "cards/CardItem";
	import type { PreviewRuntime } from "preview/runtime/previewRuntime";

	interface Props {
		items: CardItem[];
		config: ListConfig<CardItem>;
		linkContext: LinkContext;
		applicationStore: ListViewState;
		sortService: ISortService;
		app: App;
		autofocus?: boolean;
		previewRuntime?: PreviewRuntime;
	}

	let {
		items,
		config,
		linkContext,
		applicationStore,
		sortService,
		app,
		autofocus = true,
		previewRuntime = undefined,
	}: Props = $props();

	let currentItems = $state.raw<CardItem[]>(items);

	function syncItemsFromProps(): void {
		currentItems = items;
	}

	$effect(() => {
		syncItemsFromProps();
	});

	export function updateItems(nextItems: CardItem[]): void {
		currentItems = nextItems;
	}
</script>

<SearchableItemList
	items={currentItems}
	{config}
	{linkContext}
	{applicationStore}
	{sortService}
	{app}
	{previewRuntime}
	{autofocus}
/>
