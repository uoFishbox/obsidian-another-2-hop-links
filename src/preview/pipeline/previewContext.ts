import type { App, TFile } from "obsidian";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import type { PluginSettings } from "settings/model";
import type { ParsedEmbed } from "../text/mediaExtractor";
import { defaultYieldToMainThread } from "indexing/timeSlicing";
import { extractFirstEmbeddedMediaAsync } from "../text/previewTextProcessingAsync";
import { readRawContent } from "./rawContentReader";

const VISIBLE_PREVIEW_SCAN_BUDGET_CHARS = 200_000;

/** Concrete dependencies and lazy content reads for one preview generation. */
export interface PreviewContext {
	readonly vault: IVault;
	readonly metadataCache: IMetadataCache;
	readonly app: App;
	readonly settings: PluginSettings;
	readonly getContent: (signal?: AbortSignal) => Promise<string>;
	readonly getFirstEmbeddedMedia: () => Promise<ParsedEmbed | undefined>;
}

export function createPreviewContext(
	file: TFile,
	vault: IVault,
	metadataCache: IMetadataCache,
	app: App,
	settings: PluginSettings,
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
		getContent,
		getFirstEmbeddedMedia,
	};
}
