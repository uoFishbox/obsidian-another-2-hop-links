<script lang="ts">
	import type { ViewItem } from "application/presenters";
	import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";

	interface Props {
		label: string;
		searchQuery?: string;
		item?: ViewItem;
		visibility?: VirtualizedItemVisibility;
	}

	let { label, searchQuery = "", item, visibility = undefined }: Props =
		$props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="cosense-card-links__box"
	data-testid="searchable-item"
	data-label={label}
	data-search-query={searchQuery}
	data-visibility={visibility ?? ""}
	data-ccl-interaction-id={label}
	tabindex="0"
>
	{label}
</div>
