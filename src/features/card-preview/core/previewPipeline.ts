import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext } from "./previewResolver";
import { createAbortError, isAbortError } from "./previewAbort";
import { resolveCanvasPreview } from "../strategies/CanvasStrategy";
import { resolveEmbeddedMediaPreview } from "../strategies/EmbeddedMediaStrategy";
import { resolveFrontmatterImagePreview } from "../strategies/FrontmatterImageStrategy";
import { resolveFrontmatterPropertyPreview } from "../strategies/FrontmatterPropertyStrategy";
import { resolveImagePreview } from "../strategies/ImageStrategy";
import { resolvePriorityBlockPreview } from "../strategies/PriorityBlockStrategy";
import { resolveTextSnippetPreview } from "../strategies/TextSnippetStrategy";
import { resolveVideoPreview } from "../strategies/VideoStrategy";

type OptionalPreviewResolver = (
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
) => Promise<PreviewData | undefined>;

/** Resolves previews in the fixed production fallback order. */
export async function resolvePreview(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData> {
	return (
		(await tryResolve(resolveFrontmatterPropertyPreview, file, context, signal)) ??
		(await tryResolve(resolvePriorityBlockPreview, file, context, signal)) ??
		(await tryResolve(resolveImagePreview, file, context, signal)) ??
		(await tryResolve(resolveVideoPreview, file, context, signal)) ??
		(await tryResolve(resolveCanvasPreview, file, context, signal)) ??
		(await tryResolve(resolveFrontmatterImagePreview, file, context, signal)) ??
		(await tryResolve(resolveEmbeddedMediaPreview, file, context, signal)) ??
		(await tryResolve(resolveTextSnippetPreview, file, context, signal)) ?? {
			type: "empty",
			content: "",
		}
	);
}

async function tryResolve(
	resolver: OptionalPreviewResolver,
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	if (signal?.aborted) throw createAbortError();

	try {
		const result = await resolver(file, context, signal);
		if (signal?.aborted) throw createAbortError();
		return result;
	} catch (error) {
		if (isAbortError(error)) throw error;
		console.warn("Preview resolver failed:", error);
		return undefined;
	}
}
