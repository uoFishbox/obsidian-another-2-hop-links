import type { TFile, CachedMetadata } from "obsidian";
import type { PreviewData, PreviewRequestOptions } from "features/preview/public-types";

export interface LinkUtilitiesContext {
	getPreview: (
		file: TFile,
		signal?: AbortSignal,
		options?: PreviewRequestOptions,
	) => Promise<PreviewData>;
	getVisiblePreviewQueueSize?: () => number;
	getActiveVisiblePreviewCount?: () => number;
	previewSchedulingIdentity?: object;
	subscribeVisiblePreviewQueue?: (
		listener: (metrics: {
			readonly queued: number;
			readonly active: number;
		}) => void,
	) => () => void;
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
