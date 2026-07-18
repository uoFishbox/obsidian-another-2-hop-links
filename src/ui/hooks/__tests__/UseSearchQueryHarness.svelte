<script lang="ts">
	import { useSearchQuery } from "../useSearchQuery.svelte";

	interface Props {
		initialValue?: string;
		onInputChange?: (value: string) => void;
		delayMs?: number;
	}

	let { initialValue, onInputChange, delayMs }: Props = $props();
	const search = useSearchQuery({ initialValue, onInputChange, delayMs });
</script>

<input aria-label="search" bind:value={search.value} />
<span data-testid="debounced">{search.debounced}</span>
<span data-testid="normalized">{search.normalized}</span>
