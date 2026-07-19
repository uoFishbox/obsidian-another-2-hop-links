import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext, PreviewStrategy } from "../core/PreviewStrategy";
import {
	parseEmbeddedMedia,
	type ParsedEmbed,
} from "../text-processing/mediaExtractor";
import { extractFirstEmbeddedMediaAsync } from "../text-processing/previewTextProcessingAsync";
import { isImage, isVideo, readPreviewContent } from "../core/previewContent";
import {
	isFileUrlImage,
	toObsidianResourceUrl,
} from "../renderers/externalImageSource";
import { generateVideoPreview } from "../renderers/videoPreviewRenderer";

const TEXT_PREVIEW_EMBED_HOSTS = ["x.com", "twitter.com", "youtube.com", "youtu.be"];

function parseHttpUrl(target: string): URL | undefined {
	try {
		const url = new URL(target);
		return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
	} catch {
		return undefined;
	}
}

function shouldUseTextPreviewForEmbedUrl(url: URL): boolean {
	const hostname = url.hostname.toLowerCase();
	return TEXT_PREVIEW_EMBED_HOSTS.some(
		(host) => hostname === host || hostname.endsWith(`.${host}`),
	);
}

export function createEmbeddedMediaStrategy(): PreviewStrategy {
	return {
		canHandle(file: TFile, context?: PreviewContext): boolean {
			return file.extension === "md" && !!context?.metadataCache;
		},

		async generate(
			file: TFile,
			context: PreviewContext,
			signal?: AbortSignal,
		): Promise<PreviewData | undefined> {
			if (signal?.aborted) return undefined;

			const embedded = await resolveFirstEmbed(file, context, signal);
			if (signal?.aborted || !embedded) return undefined;

			return resolveEmbeddedMedia(file.path, embedded, context, signal);
		},
	};
}

async function resolveFirstEmbed(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<ParsedEmbed | undefined> {
	if (file.extension === "md") {
		const cache = context.metadataCache.getFileCache(file);
		const firstEmbed = cache?.embeds?.[0];
		if (firstEmbed) {
			return parseEmbeddedMedia(firstEmbed.original, firstEmbed.link ?? "");
		}
	}

	if (context.getFirstEmbeddedMedia) {
		return await context.getFirstEmbeddedMedia();
	}

	const content = await readPreviewContent(file, context, signal);
	if (!content) {
		return undefined;
	}

	return await extractFirstEmbeddedMediaAsync(content, {
		maxScanChars: context.scanBudgetChars,
		signal,
		yieldToMainThread: context.yieldToMainThread,
	});
}

async function resolveEmbeddedMedia(
	sourcePath: string,
	embedded: ParsedEmbed,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	const resolved = context.metadataCache.getFirstLinkpathDest(
		embedded.target,
		sourcePath,
	);

	if (resolved && isImage(resolved)) {
		return {
			type: "image",
			content: context.vault.getResourcePath(resolved),
		};
	}

	if (resolved && isVideo(resolved)) {
		return await generateVideoPreview(resolved, signal);
	}

	if (embedded.syntax !== "markdown") {
		return undefined;
	}

	if (isFileUrlImage(embedded.target)) {
		return {
			type: "image",
			content: toObsidianResourceUrl(embedded.target),
		};
	}

	const httpUrl = parseHttpUrl(embedded.target);
	if (httpUrl && !shouldUseTextPreviewForEmbedUrl(httpUrl)) {
		return { type: "image", content: embedded.target };
	}

	return undefined;
}

export default createEmbeddedMediaStrategy;
