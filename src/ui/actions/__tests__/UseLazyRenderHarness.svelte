<script lang="ts">
	import { lazyRender, type LazyRenderActionParams } from "../useLazyRender";

	interface Props {
		params: LazyRenderActionParams;
	}

	let { params }: Props = $props();
</script>

<div data-testid="lazy-target" class="preview-mount-slot" use:lazyRender={params}>
	<div class="lazy-placeholder"></div>
</div>
