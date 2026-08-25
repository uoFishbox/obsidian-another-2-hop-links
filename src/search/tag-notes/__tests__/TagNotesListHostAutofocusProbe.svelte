<script lang="ts">
	type CardItem = {
		path: string;
	};

	interface Props {
		items?: CardItem[];
		autofocus?: boolean;
		uiState?: {
			searchInputValue: string;
			scrollState?: {
				localScrollTop: number;
				visibleCount: number;
			};
		};
	}

	let { items = [], autofocus, uiState }: Props = $props();

	let currentItems = $state<CardItem[]>(items);

	$effect(() => {
		currentItems = items;
	});

	export function updateItems(nextItems: CardItem[]): void {
		currentItems = nextItems;
	}
</script>

<div
	data-testid="tag-notes-list-host"
	data-autofocus={String(autofocus)}
	data-item-count={String(currentItems.length)}
	data-search-input={uiState?.searchInputValue ?? ""}
	data-local-scroll-top={String(uiState?.scrollState?.localScrollTop ?? "")}
	data-visible-count={String(uiState?.scrollState?.visibleCount ?? "")}
></div>
