import type { TFile, CachedMetadata } from "obsidian";
import type { PreviewData, PreviewRequestOptions } from "card-preview/types";

export interface LinkUtilitiesContext {
	getPreview: (
		file: TFile,
		signal?: AbortSignal,
		options?: PreviewRequestOptions,
	) => Promise<PreviewData>;
	resolveFile: (path: string) => TFile | null;
	buildWikiLink: (targetFile: TFile | null, fallback: string) => string;
	fileToLinktext: (
		targetFile: TFile,
		sourcePath: string,
		omitMdExtension?: boolean,
	) => string;
	sourceFile: TFile;
	getMetadata: (file: TFile) => CachedMetadata | null;
	onShowFileMenu?: (event: MouseEvent, file: TFile) => void;
}
