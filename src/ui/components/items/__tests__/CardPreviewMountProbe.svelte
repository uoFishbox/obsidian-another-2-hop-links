<script module lang="ts">
	let mountSequence = 0;
</script>

<script lang="ts">
	import type { TFile } from "obsidian";
	import type { PreviewData, PreviewRequestOptions } from "ui/context/linkContext";

	interface Props {
		file: TFile | undefined;
		getPreview: (
			file: TFile,
			signal?: AbortSignal,
			options?: PreviewRequestOptions,
		) => Promise<PreviewData>;
		searchQuery?: string;
		previewRefreshToken?: number;
	}

	let { file, searchQuery = "", previewRefreshToken = 0 }: Props = $props();
	const mountId = ++mountSequence;
</script>

<div
	data-testid="card-preview-probe"
	data-mount-id={mountId}
	data-file-path={file?.path ?? ""}
	data-search-query={searchQuery}
	data-preview-refresh-token={previewRefreshToken}
></div>
