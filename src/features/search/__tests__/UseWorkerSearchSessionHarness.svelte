<script lang="ts">
	import type { App, TFile } from "obsidian";
	import { useWorkerSearchSession } from "../useWorkerSearchSession.svelte";
	import type { SearchWorkerItemSnapshot } from "../searchWorkerTypes";

	interface Props {
		app: App;
		query: string;
		enabled: boolean;
		enabledFromQuery?: boolean;
		contentIndexEnabled?: boolean;
		files: TFile[];
		getSearchableFiles?: () => TFile[];
		dataset: SearchWorkerItemSnapshot[];
		buildDataset?: () => SearchWorkerItemSnapshot[];
		matchScope?: "title-only" | "title-and-content";
		contentSearchBackend?: "worker" | "ripgrep";
		ripgrepExecutablePath?: string;
	}

	let {
		app,
		query,
		enabled,
		enabledFromQuery = false,
		contentIndexEnabled,
		files,
		getSearchableFiles,
		dataset,
		buildDataset,
		matchScope = "title-and-content",
		contentSearchBackend = "worker",
		ripgrepExecutablePath,
	}: Props = $props();

	const session = useWorkerSearchSession({
		app,
		query: () => query,
		enabled: () => (enabledFromQuery ? !!query : enabled),
		contentIndexEnabled,
		getSearchableFiles: () => getSearchableFiles?.() ?? files,
		buildDataset: () => buildDataset?.() ?? dataset,
		matchScope,
		contentSearchBackend,
		ripgrepExecutablePath,
	});

	const matchedState = $derived(
		session.matchesByKey
			? Array.from(session.matchesByKey.keys()).sort().join(",")
			: "null",
	);
	const isFiltering = $derived(session.isFiltering);
	const isLoading = $derived(session.isLoading);
	const matchedQuery = $derived(session.matchedQuery);
	const matchedScope = $derived(session.matchedScope);
	const alphaMatch = $derived(session.matchesByKey?.get("alpha"));
	const betaMatch = $derived(session.matchesByKey?.get("beta"));
	const firstMatchPosition = $derived(session.getFirstMatchPosition(query, files[0]));
	let noise = $state(0);
</script>

<div data-testid="matched-state">{matchedState}</div>
<div data-testid="is-filtering">{isFiltering ? "true" : "false"}</div>
<div data-testid="is-loading">{isLoading ? "true" : "false"}</div>
<div data-testid="matched-query">{matchedQuery}</div>
<div data-testid="matched-scope">{matchedScope}</div>
<div data-testid="matched-content">{alphaMatch?.contentMatched ? "true" : "false"}</div>
<div data-testid="matched-preview">{alphaMatch?.contentPreview ?? ""}</div>
<div data-testid="beta-matched-content">
	{betaMatch?.contentMatched ? "true" : "false"}
</div>
<div data-testid="first-match-position">
	{JSON.stringify(firstMatchPosition ?? null)}
</div>
<button type="button" data-testid="rerender-noise" onclick={() => (noise += 1)}>
	{noise}
</button>
