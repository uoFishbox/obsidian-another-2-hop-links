<script lang="ts">
	import ClickableHeader from "../ClickableHeader.svelte";

	interface Props {
		onclick?: () => void;
	}

	let { onclick }: Props = $props();
</script>

<ClickableHeader
	title="Header"
	count={2}
	{onclick}
	dataAttributes={{ "data-test-kind": "generic" }}
>
	{#snippet icon()}<span data-testid="icon">icon</span>{/snippet}
</ClickableHeader>
