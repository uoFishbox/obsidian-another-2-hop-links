<script lang="ts">
	import type { App, TFile } from "obsidian";
	import type { SearchItemSnapshot, SearchMatchScope } from "../searchTypes";
	import { useStreamingSearchSession } from "../useStreamingSearchSession.svelte";

	interface Props {
		app: App;
		query: string;
		enabled: boolean;
		files: TFile[];
		dataset: SearchItemSnapshot[];
		matchScope?: SearchMatchScope;
	}

	let {
		app,
		query,
		enabled,
		files,
		dataset,
		matchScope = "title-and-content",
	}: Props = $props();

	const session = useStreamingSearchSession({
		app,
		query: () => query,
		enabled: () => enabled,
		getSearchableFiles: () => files,
		buildDataset: () => dataset,
		matchScope: () => matchScope,
	});

	const committedKeys = $derived(
		session.committedResult
			? Array.from(session.committedResult.matchesByKey.keys()).sort().join(",")
			: "null",
	);
	const progressiveKeys = $derived(
		session.progressiveResult
			? Array.from(session.progressiveResult.matchesByKey.keys()).sort().join(",")
			: "null",
	);
	const firstPosition = $derived(session.getFirstMatchPosition(query, files[0]));
</script>

<div data-testid="committed-keys">{committedKeys}</div>
<div data-testid="progressive-keys">{progressiveKeys}</div>
<div data-testid="committed-query">{session.committedResult?.query ?? ""}</div>
<div data-testid="phase">{session.phase}</div>
<div data-testid="current">{session.currentResult ? "true" : "false"}</div>
<div data-testid="first-position">{JSON.stringify(firstPosition ?? null)}</div>
