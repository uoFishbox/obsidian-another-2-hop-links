export const INDEXING_DEBOUNCE_DELAY_MS = 300;
export const INDEXING_REBUILD_YIELD_INTERVAL_MS = 24;

// Temporarily shorten this to 8 ms on the time-slicing side after input idleness is detected.
// Yield based on elapsed time rather than file count to balance throughput and responsiveness.
export const INDEXING_YIELD_INTERVAL_MS = 24;

const INDEX_LINK_CAPABLE_EXTENSIONS = new Set(["md", "canvas"]);

/** Returns whether a file extension can contribute links to the index. */
export function isIndexLinkCapableExtension(extension: string): boolean {
	return INDEX_LINK_CAPABLE_EXTENSIONS.has(extension.toLowerCase());
}
