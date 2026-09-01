import type { App, TFile } from "obsidian";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import type { PluginSettings } from "settings/model";
import { readRawContent } from "./rawContentReader";

/** Concrete dependencies and lazy content reads for one preview generation. */
export interface PreviewContext {
	readonly vault: IVault;
	readonly metadataCache: IMetadataCache;
	readonly app: App;
	readonly settings: PluginSettings;
	readonly getContent: (signal?: AbortSignal) => Promise<string>;
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

	const getContent = (
		contentSignal: AbortSignal | undefined = signal,
	): Promise<string> => {
		if (!contentPromise) {
			contentPromise = readRawContent(file, vault, contentSignal);
		}
		return contentPromise;
	};

	return {
		vault,
		metadataCache,
		app,
		settings,
		getContent,
	};
}
