<script lang="ts">
	import type { App, TFile } from "obsidian";
	import { useWorkerSearchSession } from "../useWorkerSearchSession.svelte";
	import type { SearchWorkerItemSnapshot } from "../searchWorkerTypes";

	interface Props {
		app: App;
		query: string;
		enabled: boolean;
		enabledFromQuery?: boolean;
		files: TFile[];
		getSearchableFiles?: () => TFile[];
		dataset: SearchWorkerItemSnapshot[];
		buildDataset?: () => SearchWorkerItemSnapshot[];
		contentSyncMode?: "eager" | "when-idle" | "progressive";
		progressiveSyncIntervalMs?: number;
	}

	let {
		app,
		query,
		enabled,
		enabledFromQuery = false,
		files,
		getSearchableFiles,
		dataset,
		buildDataset,
		contentSyncMode,
		progressiveSyncIntervalMs,
	}: Props = $props();

	const session = useWorkerSearchSession({
		app,
		query: () => query,
		enabled: () => (enabledFromQuery ? !!query : enabled),
		getSearchableFiles: () => getSearchableFiles?.() ?? files,
		buildDataset: () => buildDataset?.() ?? dataset,
		contentSyncMode,
		progressiveSyncIntervalMs,
	});

	const matchedState = $derived(
		session.matchedKeySet
			? Array.from(session.matchedKeySet).sort().join(",")
			: "null",
	);
	const isFiltering = $derived(session.isFiltering);
	const isLoading = $derived(session.isLoading);
	let noise = $state(0);
</script>

<div data-testid="matched-state">{matchedState}</div>
<div data-testid="is-filtering">{isFiltering ? "true" : "false"}</div>
<div data-testid="is-loading">{isLoading ? "true" : "false"}</div>
<button type="button" data-testid="rerender-noise" onclick={() => (noise += 1)}>
	{noise}
</button>
