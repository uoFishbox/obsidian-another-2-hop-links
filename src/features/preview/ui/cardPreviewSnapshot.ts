import type { TFile } from "obsidian";
import type { PreviewData } from "features/preview/public-types";

/** Immutable input needed to mount one card preview. */
export interface CardPreviewSnapshot {
	readonly identity: string;
	readonly file: TFile;
	readonly searchQuery: string;
	readonly previewRefreshToken: number;
	readonly previewOverride: PreviewData | null;
}
