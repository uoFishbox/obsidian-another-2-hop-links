import { setContext } from "svelte";
import {
	createPreviewActivationScope,
	PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY,
	type PreviewActivationScope,
} from "./previewActivationScope";
import {
	createRowPreviewActivationRuntime,
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "./rowPreviewActivationRuntime";

export interface PreviewActivationContexts {
	readonly previewActivationScope: PreviewActivationScope;
	readonly rowPreviewActivationRuntime: RowPreviewActivationRuntime;
}

/**
 * Creates and provides preview activation contexts for one Svelte card surface.
 */
export function providePreviewActivationContexts(): PreviewActivationContexts {
	const previewActivationScope = createPreviewActivationScope();
	const rowPreviewActivationRuntime = createRowPreviewActivationRuntime({
		scope: previewActivationScope,
	});

	setContext(PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY, previewActivationScope);
	setContext(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY, rowPreviewActivationRuntime);

	return {
		previewActivationScope,
		rowPreviewActivationRuntime,
	};
}
