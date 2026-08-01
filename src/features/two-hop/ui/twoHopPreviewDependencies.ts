import type { Pos, TFile } from "obsidian";
import type {
	PreviewBackpressure,
	PreviewBackpressureListener,
} from "features/preview/scheduling/previewActivationScheduler";
import type { PreviewRuntime } from "features/preview/runtime/previewRuntime";

/**
 * Dependencies required to enable previews on a Two-hop virtual surface.
 *
 * Omitting this object disables preview runtime creation for the surface.
 */
export interface TwoHopPreviewDependencies {
	readonly previewRuntime: PreviewRuntime;
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
