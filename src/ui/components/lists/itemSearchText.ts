import type { TFile } from "obsidian";
import type { PluginSettings } from "types/settings";
import { getFileCardTitleSearchText } from "core/frontmatterCardTitle";
import type { ViewItem } from "application/presenters";
import type { LinkContext } from "ui/context/linkContext";
import {
	getBranchSearchText,
} from "features/search/searchSnapshotBuilders";

export function createItemSearchTextCache() {
	const cache = new Map<string, string>();

	return {
		clear(): void {
			cache.clear();
		},
		get(itemKey: string, compute: () => string): string {
			const cached = cache.get(itemKey);
			if (cached !== undefined) return cached;

			const value = compute();
			cache.set(itemKey, value);
			return value;
		},
	};
}

export const getItemSearchText = (
	item: ViewItem,
	linkContext: LinkContext,
	settings?: Pick<PluginSettings, "priorityFrontmatterKeyForTitle">,
): string => {
	const getFileText = (file: TFile): string =>
		getFileCardTitleSearchText(file, {
			sourcePath: linkContext.sourceFile.path,
			fileToLinktext: linkContext.fileToLinktext,
			getMetadata: linkContext.getMetadata,
			priorityFrontmatterKeyForTitle:
				settings?.priorityFrontmatterKeyForTitle,
		});

	switch (item.type) {
		case "backlink":
			return getFileText(item.data.sourceFile).toLowerCase();
		case "taggedNote":
			return getFileText(item.data.file).toLowerCase();
		case "file": {
			return getFileText(item.data).toLowerCase();
		}
		case "branch": {
			const targetFile = item.data.hop1.path
				? linkContext.resolveFile(item.data.hop1.path)
				: null;

			if (!targetFile) {
				return getBranchSearchText(item.data.hop1).toLowerCase();
			}

			return [
				getFileText(targetFile),
				getBranchSearchText(item.data.hop1),
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
		}
		default:
			return "";
	}
};
