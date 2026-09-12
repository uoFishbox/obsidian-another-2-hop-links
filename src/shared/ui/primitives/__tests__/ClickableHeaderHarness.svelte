<script lang="ts">
	import ClickableHeader from "../ClickableHeader.svelte";

	interface Props {
		onclick?: () => void;
		draggable?: boolean;
	}

	let { onclick, draggable = false }: Props = $props();
</script>

<ClickableHeader
	title="Header"
	count={2}
	{onclick}
	{draggable}
	dataAttributes={{ "data-test-kind": "generic" }}
>
	{#snippet icon()}<span data-testid="icon">icon</span>{/snippet}
</ClickableHeader>
