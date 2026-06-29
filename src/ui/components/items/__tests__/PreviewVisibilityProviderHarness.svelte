<script lang="ts">
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";
	import PreviewVisibilityProvider from "../PreviewVisibilityProvider.svelte";
	import PreviewVisibilityProviderContextProbe from "./PreviewVisibilityProviderContextProbe.svelte";

	interface Props {
		visibilityState?: VirtualizedItemVisibilityState;
		onContextRead?: () => void;
	}

	let { visibilityState, onContextRead }: Props = $props();
</script>

<PreviewVisibilityProvider {visibilityState}>
	<PreviewVisibilityProviderContextProbe {onContextRead} />
</PreviewVisibilityProvider>
