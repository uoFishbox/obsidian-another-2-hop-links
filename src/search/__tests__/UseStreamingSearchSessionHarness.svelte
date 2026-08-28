<script lang="ts">
	import type { App, Pos, TFile } from "obsidian";
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
		buildSnapshot: () => ({ items: dataset, searchableFiles: files }),
		matchScope: () => matchScope,
	});

	const visibleKeys = $derived(
		session.visibleResult
			? Array.from(session.visibleResult.result.matchesByKey.keys())
					.sort()
					.join(",")
			: "null",
	);
	let firstPosition = $state.raw<Pos | null>(null);
	let positionSerial = 0;
	$effect(() => {
		const serial = ++positionSerial;
		const currentQuery = query;
		const currentFile = files[0];
		void session
			.resolveFirstMatchPosition(currentQuery, currentFile)
			.then((position) => {
				if (serial === positionSerial) firstPosition = position ?? null;
			});
	});
</script>

<div data-testid="visible-keys">{visibleKeys}</div>
<div data-testid="visible-query">{session.visibleResult?.result.query ?? ""}</div>
<div data-testid="phase">{session.phase}</div>
<div data-testid="first-position">{JSON.stringify(firstPosition ?? null)}</div>
