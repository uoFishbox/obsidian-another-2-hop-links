import type { App, TFile } from "obsidian";
import type { IMetadataCache, IVault } from "types/obsidian";
import type { PluginSettings } from "types/settings";
import type { PreviewContext } from "./PreviewStrategy";
import type { ParsedEmbed } from "../text-processing/mediaExtractor";
import { defaultYieldToMainThread } from "core/indexing/timeSlicing";
import { extractFirstEmbeddedMediaAsync } from "../text-processing/previewTextProcessingAsync";
import { readRawContent } from "./rawContentReader";

const VISIBLE_PREVIEW_SCAN_BUDGET_CHARS = 200_000;

export function createPreviewContext(
	file: TFile,
	vault: IVault,
	metadataCache: IMetadataCache,
	app: App | undefined,
	settings: PluginSettings | undefined,
	signal?: AbortSignal,
): PreviewContext {
	let contentPromise: Promise<string> | undefined;
	let firstEmbeddedMediaPromise: Promise<ParsedEmbed | undefined> | undefined;

	const getContent = (
		contentSignal: AbortSignal | undefined = signal,
	): Promise<string> => {
		if (!contentPromise) {
			contentPromise = readRawContent(file, vault, contentSignal);
		}
		return contentPromise;
	};

	const getFirstEmbeddedMedia = (): Promise<ParsedEmbed | undefined> => {
		if (!firstEmbeddedMediaPromise) {
			firstEmbeddedMediaPromise = getContent(signal).then((content) =>
				extractFirstEmbeddedMediaAsync(content, {
					maxScanChars: VISIBLE_PREVIEW_SCAN_BUDGET_CHARS,
					yieldToMainThread: defaultYieldToMainThread,
					signal,
				}),
			);
		}
		return firstEmbeddedMediaPromise;
	};

	return {
		vault,
		metadataCache,
		app,
		settings,
		scanBudgetChars: VISIBLE_PREVIEW_SCAN_BUDGET_CHARS,
		getContent,
		getFirstEmbeddedMedia,
		yieldToMainThread: defaultYieldToMainThread,
	};
}
