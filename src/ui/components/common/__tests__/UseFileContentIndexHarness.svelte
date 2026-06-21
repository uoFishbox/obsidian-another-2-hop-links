<script lang="ts">
	import type { App, TFile } from "obsidian";
	import { useFileContentIndex } from "features/search/useFileContentIndex.svelte";

	interface Props {
		app: App;
		files: TFile[];
		targetFile: TFile | null;
		query: string;
		enabled: boolean;
	}

	let { app, files, targetFile, query, enabled }: Props = $props();

	const contentIndex = useFileContentIndex(app, () => files, {
		enabled: () => enabled,
	});

	const hasMatch = $derived(contentIndex.hasMatch(query, targetFile));
	const isLoading = $derived(contentIndex.isLoading());
	const firstMatchPosition = $derived(
		contentIndex.getFirstMatchPosition(query, targetFile),
	);
	const serializedContent = $derived(
		contentIndex.getSerializableEntries()[0]?.content ?? "",
	);
</script>

<div data-testid="has-match">{hasMatch ? "true" : "false"}</div>
<div data-testid="is-loading">{isLoading ? "true" : "false"}</div>
<div data-testid="serialized-content">{serializedContent}</div>
<div data-testid="first-match-line">
	{firstMatchPosition ? String(firstMatchPosition.start.line) : ""}
</div>
