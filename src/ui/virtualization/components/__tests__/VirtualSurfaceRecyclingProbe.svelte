<script lang="ts">
	import { onMount } from "svelte";

	interface Props {
		key: string;
		interactionId?: string;
		onCellMount?: (key: string) => void;
		onCellUpdate?: (key: string) => void;
	}

	let { key, interactionId, onCellMount, onCellUpdate }: Props = $props();

	let mounted = $state(false);
	let initialEffectDone = $state(false);

	onMount(() => {
		mounted = true;
		onCellMount?.(key);
	});

	$effect(() => {
		key;
		onCellUpdate;
		if (!mounted) return;
		if (!initialEffectDone) {
			initialEffectDone = true;
			return;
		}
		onCellUpdate?.(key);
	});
</script>

<div
	data-testid="probe-cell"
	data-key={key}
	data-ccl-interaction-id={interactionId}
	data-ccl-interaction-kind={interactionId ? "item" : undefined}
>
	{key}
</div>
