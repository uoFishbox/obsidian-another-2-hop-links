import type { TFile, App } from "obsidian";
import type { IVault, IMetadataCache } from "types/obsidian";
import type { PluginSettings } from "types/settings";
import type { PreviewData } from "../public-types";
import type { ParsedEmbed } from "../text-processing/mediaExtractor";

export type { PreviewData } from "../public-types";

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

export interface PreviewStrategy {
	canHandle(file: TFile, context?: PreviewContext): boolean;
	generate(
		file: TFile,
		context: PreviewContext,
		signal?: AbortSignal
	): Promise<PreviewData | undefined>;
}
