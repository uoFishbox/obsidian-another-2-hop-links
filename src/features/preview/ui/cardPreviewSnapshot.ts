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

/** Reactive slot state owned by a virtual card surface. */
export interface CardPreviewSlotState {
	/** Identity currently bound to this physical slot. */
	readonly bindingIdentity: string;
	/** Snapshot admitted by the preview scheduler for rendering. */
	readonly renderSnapshot: CardPreviewSnapshot | undefined;
}
