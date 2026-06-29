<script lang="ts">
	import { getContext } from "svelte";
	import {
		PREVIEW_VISIBILITY_CONTEXT_KEY,
		type PreviewVisibilityContext,
	} from "../previewVisibilityContext";

	interface Props {
		onContextRead?: () => void;
	}

	let { onContextRead }: Props = $props();

	onContextRead?.();
	const previewVisibilityContext = getContext<PreviewVisibilityContext | undefined>(
		PREVIEW_VISIBILITY_CONTEXT_KEY,
	);
	const visibility = $derived(previewVisibilityContext?.visibility);
</script>

<span data-testid="preview-visibility">{visibility}</span>
