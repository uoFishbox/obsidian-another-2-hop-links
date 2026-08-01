import type { Pos, TFile } from "obsidian";
import type { PreviewRuntime } from "features/preview/runtime/previewRuntime";

/**
 * Dependencies required to enable previews on a Two-hop virtual surface.
 *
 * Omitting this object disables preview runtime creation for the surface.
 * Backpressure, activation rate, and DOM commit rate are configured once on
 * the PreviewRuntime and must not be rebuilt per surface.
 */
export interface TwoHopPreviewDependencies {
	readonly previewRuntime: PreviewRuntime;
	readonly resolveSearchMatchPosition: (
		query: string,
		file: TFile | null | undefined,
	) => Pos | undefined;
}
