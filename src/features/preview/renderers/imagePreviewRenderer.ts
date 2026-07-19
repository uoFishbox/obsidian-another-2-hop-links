import type { CachedMetadata, TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { IMetadataCache, IVault } from "types/obsidian";
import { resolveFile } from "../core/previewContent";
import { isFileUrlImage, toObsidianResourceUrl } from "./externalImageSource";

function getMetadata(
	file: TFile,
	metadataCache: IMetadataCache,
): CachedMetadata | null {
	return metadataCache.getFileCache(file);
}

export async function getFrontmatterImage(
	file: TFile,
	metadataCache: IMetadataCache,
	vault: IVault,
): Promise<PreviewData | undefined> {
	const metadata = getMetadata(file, metadataCache);
	if (!metadata?.frontmatter?.image) {
		return undefined;
	}

	const imageUrl = metadata.frontmatter.image.trim();

	if (imageUrl.startsWith("http")) {
		return { type: "image", content: imageUrl };
	}

	if (isFileUrlImage(imageUrl)) {
		return { type: "image", content: toObsidianResourceUrl(imageUrl) };
	}

	// 内部リンクの場合
	const imageFileLink = imageUrl.match(/^\[\[([^\]]+)\]\]$/);
	if (imageFileLink) {
		const imageFile = resolveFile(imageFileLink[1], metadataCache);
		if (imageFile) {
			return {
				type: "image",
				content: vault.getResourcePath(imageFile),
			};
		}
	}

	return undefined;
}

export function generateImagePreview(file: TFile, vault: IVault): PreviewData {
	return {
		type: "image",
		content: vault.getResourcePath(file),
	};
}
