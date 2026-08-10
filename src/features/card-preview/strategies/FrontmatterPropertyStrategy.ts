import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext } from "../core/previewResolver";

/**
 * 設定で指定されたfrontmatterプロパティの値を優先的にプレビュー表示する戦略
 */
export async function resolveFrontmatterPropertyPreview(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	if (file.extension !== "md" || signal?.aborted) return undefined;
	const key = context.settings?.priorityFrontmatterKeyForPreview?.trim();
	if (!key) return undefined;

	const value = context.metadataCache.getFileCache(file)?.frontmatter?.[key];
	if (value === undefined || value === null || value === "") return undefined;

	let content: string;
	if (typeof value === "string") content = value;
	else if (Array.isArray(value)) content = value.join(", ");
	else if (typeof value === "object") content = JSON.stringify(value);
	else content = String(value);

	const trimmedContent = content.trim();
	return trimmedContent ? { type: "text", content: trimmedContent } : undefined;
}
