<script lang="ts">
	import { ARIA_LABELS } from "appConstants";
	import Icon from "ui/components/common/Icon.svelte";

	interface CardGridLoadMoreButtonProps {
		onClick: () => void;
		testId?: string;
	}

	let { onClick, testId = undefined }: CardGridLoadMoreButtonProps = $props();
</script>

<button
	type="button"
	class="cosense-card-links__load-more-button cosense-card-links__box"
	aria-label={ARIA_LABELS.LOAD_MORE}
	{...testId ? { "data-testid": testId } : {}}
	onclick={onClick}
>
	<Icon name="Ellipsis" width={28} height={28} />
</button>
