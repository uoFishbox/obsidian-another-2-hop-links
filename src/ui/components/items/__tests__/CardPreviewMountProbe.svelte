<script module lang="ts">
	let mountSequence = 0;
</script>

<script lang="ts">
	import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";

	interface Props {
		request: CardPreviewRequest;
	}

	let { request }: Props = $props();
	const mountId = ++mountSequence;
</script>

<div
	data-testid="card-preview-probe"
	data-mount-id={mountId}
	data-binding-identity={request.renderKey}
	data-file-path={request.file.path}
	data-search-query={request.searchQuery}
	data-preview-refresh-token={request.previewCacheRevision}
></div>
