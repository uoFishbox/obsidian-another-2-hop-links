<script lang="ts">
	import type { App } from "obsidian";
	import { useBookmarks } from "../useBookmarks.svelte";

	interface Props {
		app: App;
		firstPath: string;
		secondPath: string;
	}

	let { app, firstPath, secondPath }: Props = $props();

	const firstBookmarks = useBookmarks(app);
	const secondBookmarks = useBookmarks(app);
	const firstIsBookmarked = $derived(firstBookmarks.isBookmarked(firstPath));
	const secondIsBookmarked = $derived(secondBookmarks.isBookmarked(secondPath));
	const firstBookmarkCount = $derived(firstBookmarks.filePaths.size);
	const secondBookmarkCount = $derived(secondBookmarks.filePaths.size);
</script>

<div data-testid="first-is-bookmarked">
	{firstIsBookmarked ? "true" : "false"}
</div>
<div data-testid="second-is-bookmarked">
	{secondIsBookmarked ? "true" : "false"}
</div>
<div data-testid="first-bookmark-count">{firstBookmarkCount}</div>
<div data-testid="second-bookmark-count">{secondBookmarkCount}</div>
