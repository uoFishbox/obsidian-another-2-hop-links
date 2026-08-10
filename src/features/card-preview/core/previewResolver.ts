import type { App, TFile } from "obsidian";
import type { PluginSettings } from "features/settings/model";
import type { IMetadataCache, IVault } from "types/obsidian";
import type { PreviewData } from "../public-types";
import type { ParsedEmbed } from "../text-processing/mediaExtractor";

export interface PreviewContext {
	vault: IVault;
	metadataCache: IMetadataCache;
	app?: App;
	settings?: PluginSettings;
	scanBudgetChars?: number;
	getContent?: (signal?: AbortSignal) => Promise<string>;
	getFirstEmbeddedMedia?: () => Promise<ParsedEmbed | undefined>;
	yieldToMainThread?: () => Promise<void>;
}

export type PreviewResolver = (
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
) => Promise<PreviewData>;
