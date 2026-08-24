<script lang="ts">
	import type { App } from "obsidian";
	import SearchableItemList from "./SearchableItemList.svelte";
	import type { ListConfig } from "./types";
	import type { LinkContext } from "ui/context/linkContext";
	import type { ListViewState } from "features/list-view/model/ListViewState";
	import type { ISortService } from "core/sorting";
	import type { ViewItem } from "application/presenters/ViewItem";
	import type { PreviewRuntime } from "features/card-preview/runtime/previewRuntime";

	interface Props {
		items: ViewItem[];
		config: ListConfig<ViewItem>;
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

	let currentItems = $state.raw<ViewItem[]>(items);

	function syncItemsFromProps(): void {
		currentItems = items;
	}

	$effect(() => {
		syncItemsFromProps();
	});

	export function updateItems(nextItems: ViewItem[]): void {
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
