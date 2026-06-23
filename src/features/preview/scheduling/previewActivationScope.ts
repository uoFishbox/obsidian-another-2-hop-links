import {
	createPreviewActivationScope as createSchedulerPreviewActivationScope,
	type PreviewActivationScope,
} from "./previewActivationScheduler";

export type { PreviewActivationScope };

export const PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY = Symbol("preview-activation-scope");

/**
 * Creates preview scheduling state isolated to one rendered card surface.
 */
export function createPreviewActivationScope(): PreviewActivationScope {
	return createSchedulerPreviewActivationScope();
}
