import type { App, Pos, TFile } from "obsidian";
import type {
	PreviewBackpressure,
	PreviewBackpressureListener,
} from "features/preview/scheduling/previewActivationScheduler";
import type { CardPreviewLoader } from "features/preview/ui/cardPreviewRenderer";
import type { PluginSettings } from "features/settings/model";

/**
 * Dependencies required to enable previews on a Two-hop virtual surface.
 *
 * Omitting this object disables preview runtime creation for the surface.
 */
export interface TwoHopPreviewDependencies {
	readonly app: App;
	readonly getPreview: CardPreviewLoader;
	readonly getSettings: () => PluginSettings;
	readonly getPreviewRenderVersion: (filePath: string) => string;
	readonly resolveSearchMatchPosition: (
		query: string,
		file: TFile | null | undefined,
	) => Pos | undefined;
	readonly getBackpressure: () => PreviewBackpressure;
	readonly subscribeBackpressure?: (
		listener: PreviewBackpressureListener,
	) => () => void;
	readonly schedulerIdentity?: object;
	readonly getActivationsPerSecond: () => number;
	readonly getDomCommitsPerSecond: () => number;
}
