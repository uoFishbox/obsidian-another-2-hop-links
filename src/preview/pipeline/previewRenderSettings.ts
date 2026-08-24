import type { PluginSettings } from "settings/model";

/** Fixed search-snippet seek policy after the corresponding settings were removed. */
export const SEARCH_PREVIEW_SEEK_THRESHOLD_CHARS = 0;
export const SEARCH_PREVIEW_SEEK_BUFFER_CHARS = 15;

/** Settings which can change generated or rendered card preview content. */
export interface PreviewRenderSettings {
	readonly cardWidthPx: number;
	readonly cardHeightRatio: number;
	readonly previewMaxChars: number;
	readonly previewMaxLines: number;
	readonly previewVisualLineSafetyMargin: number;
	readonly priorityFrontmatterKeyForPreview: string;
}

const settingsSnapshots = new WeakMap<PluginSettings, PreviewRenderSettings>();

/** Creates an immutable, narrowly-scoped snapshot for one preview request. */
export function createPreviewRenderSettings(
	settings: PluginSettings,
): PreviewRenderSettings {
	const cached = settingsSnapshots.get(settings);
	if (cached && hasSamePreviewRenderSettings(cached, settings)) return cached;

	const snapshot: PreviewRenderSettings = Object.freeze({
		cardWidthPx: settings.cardWidthPx,
		cardHeightRatio: settings.cardHeightRatio,
		previewMaxChars: settings.previewMaxChars,
		previewMaxLines: settings.previewMaxLines,
		previewVisualLineSafetyMargin: settings.previewVisualLineSafetyMargin,
		priorityFrontmatterKeyForPreview:
			settings.priorityFrontmatterKeyForPreview ?? "",
	});
	settingsSnapshots.set(settings, snapshot);
	return snapshot;
}

function hasSamePreviewRenderSettings(
	previous: PreviewRenderSettings,
	next: PluginSettings,
): boolean {
	return (
		previous.cardWidthPx === next.cardWidthPx &&
		previous.cardHeightRatio === next.cardHeightRatio &&
		previous.previewMaxChars === next.previewMaxChars &&
		previous.previewMaxLines === next.previewMaxLines &&
		previous.previewVisualLineSafetyMargin === next.previewVisualLineSafetyMargin &&
		previous.priorityFrontmatterKeyForPreview ===
			next.priorityFrontmatterKeyForPreview
	);
}
