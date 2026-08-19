<script lang="ts">
	import type { App, TFile } from "obsidian";
	import { useFileContentIndex } from "features/search/useFileContentIndex.svelte";
	import { getSearchQueryTerms } from "features/search/searchQueryTerms";

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

	const isLoading = $derived(contentIndex.isLoading());
	const firstMatchPosition = $derived(
		contentIndex.getFirstMatchPosition(query, targetFile),
	);
	const targetContent = $derived.by(() => {
		let content = "";
		contentIndex.forEachEntry((path, entry) => {
			if (path === targetFile?.path) content = entry.content;
		});
		return content;
	});
	const contentMatchesQuery = $derived.by(() => {
		const terms = getSearchQueryTerms(query);
		return terms.length > 0 && terms.every((term) => targetContent.includes(term));
	});
	const serializedContent = $derived(targetContent);
</script>

<div data-testid="has-match">{contentMatchesQuery ? "true" : "false"}</div>
<div data-testid="is-loading">{isLoading ? "true" : "false"}</div>
<div data-testid="serialized-content">{serializedContent}</div>
<div data-testid="first-match-line">
	{firstMatchPosition ? String(firstMatchPosition.start.line) : ""}
</div>
