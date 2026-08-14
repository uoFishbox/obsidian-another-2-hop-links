<script lang="ts">
	import type { ViewItem } from "application/presenters";

	interface Props {
		label: string;
		searchQuery?: string;
		item?: ViewItem;
	}

	let { label, searchQuery = "", item }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="cosense-card-links__box"
	data-testid="searchable-item"
	data-label={label}
	data-search-query={searchQuery}
	data-ccl-interaction-id={label}
	tabindex="0"
>
	{label}
</div>
