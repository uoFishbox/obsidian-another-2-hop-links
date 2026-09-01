import type { TFile } from "obsidian";
import type { PreviewData } from "../types";
import type { PreviewContext } from "../pipeline/previewContext";
import { parseEmbeddedMedia, type ParsedEmbed } from "../text/mediaExtractor";
import { isImage, isVideo } from "../pipeline/previewContent";
import {
	isFileUrlImage,
	toObsidianResourceUrl,
} from "../renderers/externalImageSource";
import { generateVideoPreview } from "../renderers/videoPreviewRenderer";
import { resolveWorkspaceDocument } from "obsidian-integration/workspace/workspaceDocuments";

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

export async function resolveEmbeddedMediaPreview(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	if (file.extension !== "md" || signal?.aborted) return undefined;
	const embedded = resolveFirstEmbed(file, context);
	if (signal?.aborted || !embedded) return undefined;
	return resolveEmbeddedMedia(file.path, embedded, context, signal);
}

function resolveFirstEmbed(
	file: TFile,
	context: PreviewContext,
): ParsedEmbed | undefined {
	const firstEmbed = context.metadataCache.getFileCache(file)?.embeds?.[0];
	if (!firstEmbed) return undefined;
	return parseEmbeddedMedia(firstEmbed.original, firstEmbed.link ?? "");
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
		return await generateVideoPreview(
			resolved,
			signal,
			resolveWorkspaceDocument(context.app.workspace),
		);
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
