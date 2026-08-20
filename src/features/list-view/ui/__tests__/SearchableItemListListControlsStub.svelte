<script lang="ts">
	interface Props {
		searchInputValue?: string;
		sortOption?: string;
		onSortChange?: (value: string) => void;
		onSearchInput?: (value: string) => void;
		contentSearchEnabled?: boolean;
		onToggleContentSearch?: () => void;
		autofocus?: boolean;
		showSearchInput?: boolean;
	}

	let {
		searchInputValue = $bindable(""),
		sortOption = "alphabetical",
		onSortChange = () => {},
		onSearchInput = () => {},
		contentSearchEnabled = false,
		onToggleContentSearch = () => {},
		autofocus = false,
		showSearchInput = true,
	}: Props = $props();
</script>

<div
	data-testid="list-controls"
	data-search-input-value={searchInputValue}
	data-sort-option={sortOption}
	data-content-search-enabled={String(contentSearchEnabled)}
	data-autofocus={String(autofocus)}
	data-show-search-input={String(showSearchInput)}
>
	<button type="button" onclick={() => onSortChange(sortOption)}>stub</button>
	<button type="button" onclick={() => onSearchInput(searchInputValue)}>
		search
	</button>
	<button type="button" onclick={onToggleContentSearch}>toggle-content-search</button>
</div>
