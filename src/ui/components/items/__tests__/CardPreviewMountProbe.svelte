<script module lang="ts">
	let mountSequence = 0;
</script>

<script lang="ts">
	import type { TFile } from "obsidian";
	import type { PreviewData, PreviewRequestOptions } from "ui/context/linkContext";
	import type { CardPreviewSnapshot } from "features/preview/ui/cardPreviewSnapshot";

	interface Props {
		file?: TFile;
		bindingIdentity?: string;
		renderSnapshot?: CardPreviewSnapshot;
		getPreview: (
			file: TFile,
			signal?: AbortSignal,
			options?: PreviewRequestOptions,
		) => Promise<PreviewData>;
		searchQuery?: string;
		previewRefreshToken?: number;
	}

	let {
		file = undefined,
		bindingIdentity = "",
		renderSnapshot = undefined,
		searchQuery = "",
		previewRefreshToken = 0,
	}: Props = $props();
	const mountId = ++mountSequence;
	const effectiveFile = $derived(renderSnapshot?.file ?? file);
	const effectiveSearchQuery = $derived(renderSnapshot?.searchQuery ?? searchQuery);
	const effectiveRefreshToken = $derived(
		renderSnapshot?.previewRefreshToken ?? previewRefreshToken,
	);
</script>

<div
	data-testid="card-preview-probe"
	data-mount-id={mountId}
	data-binding-identity={bindingIdentity}
	data-file-path={effectiveFile?.path ?? ""}
	data-search-query={effectiveSearchQuery}
	data-preview-refresh-token={effectiveRefreshToken}
></div>
