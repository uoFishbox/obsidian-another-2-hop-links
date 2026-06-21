<script lang="ts">
	import { lazyRender, type LazyRenderActionParams } from "../useLazyRender";

	interface Props {
		params: LazyRenderActionParams;
		minHeight?: number;
	}

	let { params, minHeight = 80 }: Props = $props();
</script>

<div
	data-testid="lazy-target"
	class="preview-mount-slot"
	use:lazyRender={params}
	style:min-height={`${minHeight}px`}
>
	<div class="lazy-placeholder"></div>
</div>
