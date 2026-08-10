import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext } from "../core/previewResolver";
import { getFrontmatterImage } from "../renderers/imagePreviewRenderer";

export async function resolveFrontmatterImagePreview(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	if (file.extension !== "md" || signal?.aborted) return undefined;
	const image = context.metadataCache.getFileCache(file)?.frontmatter?.image;
	if (typeof image !== "string" || image.trim().length === 0) return undefined;
	return await getFrontmatterImage(file, context.metadataCache, context.vault);
}
