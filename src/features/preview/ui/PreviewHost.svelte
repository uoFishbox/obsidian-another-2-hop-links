<script lang="ts">
	import { getVirtualPreviewSurface } from "./virtualPreviewSurfaceContext";

	interface Props {
		slotId: string;
	}

	const { slotId }: Props = $props();
	const surface = getVirtualPreviewSurface();
	let element: HTMLDivElement;

	$effect(() => {
		const lease = surface.registerHost(slotId, element);
		return () => lease.dispose();
	});
</script>

<div
	bind:this={element}
	class="cosense-card-links__box-preview"
	data-preview-state="empty"
	data-preview-owner="virtual-surface"
></div>
