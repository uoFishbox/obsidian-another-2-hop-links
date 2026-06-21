<script lang="ts">
	import { onMount } from "svelte";

	interface Props {
		item: string;
		index: number;
		onItemMount?: (id: string) => void;
		onItemUpdate?: (id: string) => void;
	}

	let { item, index, onItemMount, onItemUpdate }: Props = $props();

	const probeId = $derived(`${index}-${item}`);

	let mounted = $state(false);
	let didCommitInitialEffect = $state(false);

	onMount(() => {
		mounted = true;
		onItemMount?.(probeId);
	});

	$effect(() => {
		probeId;
		onItemUpdate;

		if (!mounted) {
			return;
		}

		if (!didCommitInitialEffect) {
			didCommitInitialEffect = true;
			return;
		}

		onItemUpdate?.(probeId);
	});
</script>

<div
	class="test-cell cosense-card-links__box"
	data-testid="probe-item-cell"
	data-index={index}
>
	{item}
</div>

<style>
	.test-cell {
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
