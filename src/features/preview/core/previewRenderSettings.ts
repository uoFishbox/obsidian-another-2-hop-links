import type { PluginSettings } from "features/settings/model";
import { DEFAULT_SETTINGS } from "features/settings/model";

/** Settings which can change generated or rendered card preview content. */
export interface PreviewRenderSettings {
	readonly cardWidthPx: number;
	readonly cardHeightRatio: number;
	readonly previewMaxChars: number;
	readonly previewMaxLines: number;
	readonly previewVisualLineSafetyMargin: number;
	readonly priorityFrontmatterKeyForPreview: string;
	readonly renderCodeBlockTypes: readonly string[];
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
		renderCodeBlockTypes: Object.freeze([...settings.renderCodeBlockTypes]),
		searchPreviewSeekThresholdChars:
			settings.searchPreviewSeekThresholdChars ??
			DEFAULT_SETTINGS.searchPreviewSeekThresholdChars ??
			0,
		searchPreviewSeekBufferChars:
			settings.searchPreviewSeekBufferChars ??
			DEFAULT_SETTINGS.searchPreviewSeekBufferChars ??
			0,
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
			next.priorityFrontmatterKeyForPreview &&
		previous.searchPreviewSeekThresholdChars ===
			next.searchPreviewSeekThresholdChars &&
		previous.searchPreviewSeekBufferChars === next.searchPreviewSeekBufferChars &&
		hasSameStringArray(previous.renderCodeBlockTypes, next.renderCodeBlockTypes)
	);
}

function hasSameStringArray(
	previous: readonly string[],
	next: readonly string[],
): boolean {
	return (
		previous.length === next.length &&
		previous.every((value, index) => value === next[index])
	);
}
