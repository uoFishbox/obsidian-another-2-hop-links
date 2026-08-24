import type { PluginSettings } from "features/settings/model";

const SEARCH_PREVIEW_SEEK_THRESHOLD_CHARS = 0;
const SEARCH_PREVIEW_SEEK_BUFFER_CHARS = 15;

/** Settings which can change generated or rendered card preview content. */
export interface PreviewRenderSettings {
	readonly cardWidthPx: number;
	readonly cardHeightRatio: number;
	readonly previewMaxChars: number;
	readonly previewMaxLines: number;
	readonly previewVisualLineSafetyMargin: number;
	readonly priorityFrontmatterKeyForPreview: string;
	readonly searchPreviewSeekThresholdChars: number;
	readonly searchPreviewSeekBufferChars: number;
}

/** Accepted only at compilation/cache compatibility boundaries. */
export type PreviewRenderSettingsInput = PreviewRenderSettings | PluginSettings;

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
		searchPreviewSeekThresholdChars: SEARCH_PREVIEW_SEEK_THRESHOLD_CHARS,
		searchPreviewSeekBufferChars: SEARCH_PREVIEW_SEEK_BUFFER_CHARS,
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
