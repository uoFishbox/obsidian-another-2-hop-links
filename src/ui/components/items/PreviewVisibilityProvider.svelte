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

	const context: PreviewVisibilityContext = visibilityState ?? createOwnedContext();

	setContext(PREVIEW_VISIBILITY_CONTEXT_KEY, context);

	function createOwnedContext(): PreviewVisibilityContext {
		let vis = $state(visibility);
		return {
			get visibility() {
				return vis;
			},
			set visibility(v: VirtualizedItemVisibility | undefined) {
				vis = v;
			},
		};
	}

	$effect.pre(() => {
		if (!visibilityState) {
			context.visibility = visibility;
		}
	});
</script>

{@render children?.()}
