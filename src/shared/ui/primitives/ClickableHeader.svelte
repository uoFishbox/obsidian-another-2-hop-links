<script lang="ts">
	import type { Snippet } from "svelte";

	export interface Props {
		title: string;
		count: number;
		icon: Snippet;
		className?: string;
		draggable?: boolean;
		onclick?: () => void;
		dataAttributes?: Readonly<Record<`data-${string}`, string | undefined>>;
	}

	let {
		title,
		count,
		icon,
		className = "",
		draggable = false,
		onclick,
		dataAttributes = {},
	}: Props = $props();

	const ariaLabel = $derived(`${count} notes`);
</script>

<div
	{...dataAttributes}
	class="cosense-card-links__box cosense-card-links__twohop-header {className}"
	role="button"
	tabindex="0"
	aria-label={ariaLabel}
	{draggable}
	onclick={() => onclick?.()}
	onkeydown={(event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onclick?.();
		}
	}}
>
	<div class="cosense-card-links__title-container">
		<span class="cosense-card-links__header-title">{title}</span>
	</div>
	{@render icon()}
</div>
