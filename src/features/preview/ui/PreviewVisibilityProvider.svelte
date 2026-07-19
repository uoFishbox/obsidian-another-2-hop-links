<script lang="ts">
	import { setContext, type Snippet } from "svelte";
	import type {
		VirtualizedItemVisibility,
		VirtualizedItemVisibilityState,
	} from "ui/components/common/virtualizedItemVisibility";
	import {
		PREVIEW_VISIBILITY_CONTEXT_KEY,
		type PreviewVisibilityContext,
	} from "./previewVisibilityContext";

	interface Props {
		visibility?: VirtualizedItemVisibility;
		visibilityState?: VirtualizedItemVisibilityState;
		children?: Snippet;
	}

	let {
		visibility = undefined,
		visibilityState = undefined,
		children,
	}: Props = $props();

	let ownedVisibility = $state<VirtualizedItemVisibility | undefined>(visibility);
	const providedVisibilityState = $derived(visibilityState);

	const context: PreviewVisibilityContext = {
		get visibility() {
			return providedVisibilityState?.visibility ?? ownedVisibility;
		},
	};

	setContext(PREVIEW_VISIBILITY_CONTEXT_KEY, context);

	$effect.pre(() => {
		if (!providedVisibilityState) {
			ownedVisibility = visibility;
		}
	});
</script>

{@render children?.()}
