import { onDestroy, setContext } from "svelte";
import {
	createPreviewActivationScope,
	PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY,
	type CreatePreviewActivationScopeOptions,
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

export interface ProvidePreviewActivationContextsOptions extends CreatePreviewActivationScopeOptions {}

/**
 * Creates and provides preview activation contexts for one Svelte card surface.
 */
export function providePreviewActivationContexts(
	options: ProvidePreviewActivationContextsOptions = {},
): PreviewActivationContexts {
	const previewActivationScope = createPreviewActivationScope(options);
	const rowPreviewActivationRuntime = createRowPreviewActivationRuntime({
		scope: previewActivationScope,
	});

	setContext(PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY, previewActivationScope);
	setContext(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY, rowPreviewActivationRuntime);
	onDestroy(() => rowPreviewActivationRuntime.dispose());

	return {
		previewActivationScope,
		rowPreviewActivationRuntime,
	};
}
