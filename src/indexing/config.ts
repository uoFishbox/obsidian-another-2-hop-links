export const INDEXING_DEBOUNCE_DELAY_MS = 300;
export const INDEXING_REBUILD_YIELD_INTERVAL_MS = 24;

// 入力待ち検出後は timeSlicing 側で一時的に8msへ短縮する。
// ファイル数ではなく経過時間でyieldすることで、速度と応答性を両立する。
export const INDEXING_YIELD_INTERVAL_MS = 24;

const INDEX_LINK_CAPABLE_EXTENSIONS = new Set(["md", "canvas"]);

/** Returns whether a file extension can contribute links to the index. */
export function isIndexLinkCapableExtension(extension: string): boolean {
	return INDEX_LINK_CAPABLE_EXTENSIONS.has(extension.toLowerCase());
}
