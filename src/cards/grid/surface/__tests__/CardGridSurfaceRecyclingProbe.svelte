<script lang="ts">
	import { onMount, untrack } from "svelte";

	interface CardGridSurfaceRecyclingProbeProps {
		key: string;
		interactionId?: string;
		onCellMount?: (key: string) => void;
		onCellUpdate?: (key: string) => void;
		onCellUnmount?: (key: string) => void;
	}

	let {
		key,
		interactionId,
		onCellMount,
		onCellUpdate,
		onCellUnmount,
	}: CardGridSurfaceRecyclingProbeProps = $props();

	let mounted = $state(false);
	let initialEffectDone = $state(false);

	onMount(() => {
		mounted = true;
		onCellMount?.(key);
	});

	$effect(() => {
		const nextKey = key;
		if (!mounted) return;
		if (!initialEffectDone) {
			initialEffectDone = true;
			return;
		}
		untrack(() => onCellUpdate?.(nextKey));
	});

	$effect(() => {
		key;
		return () => {
			onCellUnmount?.(key);
		};
	});
</script>

<div data-testid="probe-cell" data-key={key} data-ccl-interaction-id={interactionId}>
	{key}
</div>
