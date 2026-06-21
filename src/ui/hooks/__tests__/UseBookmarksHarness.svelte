<script lang="ts">
	import type { App } from "obsidian";
	import { useBookmarks } from "../useBookmarks.svelte";

	interface Props {
		app: App;
		path: string;
	}

	let { app, path }: Props = $props();

	const bookmarks = useBookmarks(app);
	const isBookmarked = $derived(bookmarks.isBookmarked(path));
	const bookmarkCount = $derived(bookmarks.filePaths.size);
	const orderedPaths = $derived(
		(bookmarks.filePaths.size, bookmarks.orderedFilePaths.join(",")),
	);
</script>

<div data-testid="is-bookmarked">{isBookmarked ? "true" : "false"}</div>
<div data-testid="bookmark-count">{bookmarkCount}</div>
<div data-testid="ordered-file-paths">{orderedPaths}</div>
