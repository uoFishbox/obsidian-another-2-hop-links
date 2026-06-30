<script lang="ts">
	import { ARIA_LABELS } from "../../../../appConstants";
	import { ICON_PATHS, svgAttrs } from "ui/utils/icons";

	interface Props {
		onClick: () => void;
		testId?: string;
	}

	let { onClick, testId = undefined }: Props = $props();
</script>

<button
	type="button"
	class="cosense-card-links__load-more-button cosense-card-links__box"
	aria-label={ARIA_LABELS.LOAD_MORE}
	{...testId ? { "data-testid": testId } : {}}
	onclick={onClick}
>
	<svg {...svgAttrs} width="28" height="28" stroke="currentColor">
		{@html ICON_PATHS.Ellipsis}
	</svg>
</button>
