import type { VirtualPreviewSurface } from "card-preview/scheduling/virtualPreviewSurface";

/** Stateless preview surface used when preview rendering is unavailable. */
export const DISABLED_PREVIEW_SURFACE: VirtualPreviewSurface = {
	registerHost: () => ({ dispose: () => {} }),
	publish: () => {},
	dispose: () => {},
};
