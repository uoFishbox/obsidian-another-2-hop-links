import type { TFile } from "obsidian";
import type { PluginSettings } from "features/settings/model";
import { getFileCardTitleSearchText } from "core/frontmatterCardTitle";
import type { ViewItem } from "application/presenters";
import type { LinkContext } from "ui/context/linkContext";

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
	const sourcePath = linkContext.sourceFile.path;
	const fileToLinktext = linkContext.fileToLinktext;
	const getMetadata = linkContext.getMetadata;
	const frontmatterKey = settings?.priorityFrontmatterKeyForTitle;

	const getFileText = (file: TFile): string =>
		getFileCardTitleSearchText(
			file,
			sourcePath,
			fileToLinktext,
			getMetadata,
			frontmatterKey,
		);

	switch (item.type) {
		case "backlink":
			return getFileText(item.data.sourceFile).toLowerCase();
		case "taggedNote":
			return getFileText(item.data.file).toLowerCase();
		case "file":
			return getFileText(item.data).toLowerCase();
		case "branch": {
			const branchText = item.data.hop1.rawText ?? item.data.hop1.path ?? "";
			const targetFile = item.data.hop1.path
				? linkContext.resolveFile(item.data.hop1.path)
				: null;

			if (!targetFile) {
				return branchText.toLowerCase();
			}

			const titleText = getFileText(targetFile);
			return (
				titleText && branchText
					? `${titleText} ${branchText}`
					: titleText || branchText
			).toLowerCase();
		}
		default:
			return "";
	}
};
