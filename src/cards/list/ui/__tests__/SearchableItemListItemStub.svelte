<script lang="ts">
	import type { CardRenderModel } from "cards/rendering/cardRenderModel";

	interface Props {
		model: CardRenderModel;
	}

	let { model }: Props = $props();
	let item = $derived(model.item);
	const label = $derived.by(() => {
		switch (item.type) {
			case "taggedNote":
				return item.data.file.basename;
			case "file":
				return item.data.basename;
			case "backlink":
				return item.data.sourceFile.basename;
			case "branch":
				return item.data.hop1.path ?? item.data.hop1.rawText;
			case "newLink":
				return item.data.path ?? item.data.rawText;
		}
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="cosense-card-links__box"
	data-testid="searchable-item"
	data-label={label}
	data-ccl-interaction-handle={label}
	tabindex="0"
>
	{label}
</div>
