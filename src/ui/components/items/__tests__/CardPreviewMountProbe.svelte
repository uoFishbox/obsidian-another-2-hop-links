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
	}

	let { searchQuery = "" }: Props = $props();
	const mountId = ++mountSequence;
</script>

<div
	data-testid="card-preview-probe"
	data-mount-id={mountId}
	data-search-query={searchQuery}
></div>
