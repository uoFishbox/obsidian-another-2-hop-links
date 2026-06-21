import type { TFile } from "obsidian";
import type { IMetadataCache } from "types/obsidian";

export function resolveFrontmatterDate(
	metadataCache: IMetadataCache,
	file: TFile,
	key: string,
): number | null {
	const cache = metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter;

	if (!frontmatter || !(key in frontmatter)) {
		return null;
	}

	const value = frontmatter[key];
	if (value instanceof Date) {
		return value.getTime();
	}

	if (typeof value === "string") {
		const timestamp = Date.parse(value);
		if (!isNaN(timestamp)) {
			return timestamp;
		}
	}

	if (typeof value === "number") {
		return value;
	}

	return null;
}
