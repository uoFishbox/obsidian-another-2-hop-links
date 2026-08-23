<script lang="ts">
	import type { App } from "obsidian";
	import { useBookmarks } from "../useBookmarks.svelte";

	interface Props {
		app: App;
		paths: string[];
	}

	let { app, paths }: Props = $props();

	const bookmarkStates = paths.map(() => useBookmarks(app));
	const bookmarkStatuses = $derived(
		paths.map((path, index) => bookmarkStates[index]?.isBookmarked(path) ?? false),
	);
	const primaryBookmarks = bookmarkStates[0];
	const bookmarkCount = $derived(primaryBookmarks?.filePaths.size ?? 0);
	const orderedPaths = $derived(
		primaryBookmarks
			? (primaryBookmarks.filePaths.size,
				primaryBookmarks.orderedFilePaths.join(","))
			: "",
	);
</script>

{#each bookmarkStatuses as isBookmarked, index}
	<div data-testid={`bookmark-status-${index}`}>
		{isBookmarked ? "true" : "false"}
	</div>
{/each}
<div data-testid="bookmark-count">{bookmarkCount}</div>
<div data-testid="ordered-file-paths">{orderedPaths}</div>
