import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext } from "../core/previewResolver";
import { isVideo } from "../core/previewContent";
import { generateVideoPreview } from "../renderers/videoPreviewRenderer";
import { resolveWorkspaceDocument } from "infrastructure/workspace/workspaceDocuments";

export async function resolveVideoPreview(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	if (!isVideo(file) || signal?.aborted) return undefined;
	return await generateVideoPreview(
		file,
		signal,
		context.app ? resolveWorkspaceDocument(context.app.workspace) : undefined,
	);
}
