import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext, PreviewStrategy } from "../core/PreviewStrategy";
import { getFrontmatterImage } from "../renderers/imagePreviewRenderer";

export function createFrontmatterImageStrategy(): PreviewStrategy {
	return {
		canHandle(file: TFile, context?: PreviewContext) {
			if (file.extension !== "md") return false;

			const image = context?.metadataCache.getFileCache(file)?.frontmatter?.image;
			return typeof image === "string" && image.trim().length > 0;
		},

		async generate(
			file: TFile,
			context: PreviewContext,
			signal?: AbortSignal,
		): Promise<PreviewData | undefined> {
			if (signal?.aborted) return undefined;
			return await getFrontmatterImage(
				file,
				context.metadataCache,
				context.vault,
			);
		},
	};
}

export const frontmatterImageStrategy: PreviewStrategy =
	createFrontmatterImageStrategy();

export default createFrontmatterImageStrategy;
