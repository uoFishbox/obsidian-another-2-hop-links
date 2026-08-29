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

/** Actual card dimensions already resolved by a card-grid layout. */
export interface PreviewCardDimensions {
	readonly widthPx: number;
	readonly heightPx: number;
}

interface DimensionedSettingsCacheEntry {
	readonly widthPx: number;
	readonly heightPx: number;
	readonly settings: PreviewRenderSettings;
}

const settingsSnapshots = new WeakMap<PluginSettings, PreviewRenderSettings>();
const dimensionedSettingsSnapshots = new WeakMap<
	PreviewRenderSettings,
	DimensionedSettingsCacheEntry
>();

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

/** Replaces configured card geometry with one grid's resolved cell geometry. */
export function applyPreviewCardDimensions(
	settings: PreviewRenderSettings,
	dimensions: PreviewCardDimensions,
): PreviewRenderSettings {
	const widthPx = normalizeDimension(dimensions.widthPx, settings.cardWidthPx);
	const fallbackHeightPx = settings.cardWidthPx * settings.cardHeightRatio;
	const heightPx = normalizeDimension(dimensions.heightPx, fallbackHeightPx);
	const cardHeightRatio = heightPx / widthPx;
	if (
		settings.cardWidthPx === widthPx &&
		settings.cardHeightRatio === cardHeightRatio
	) {
		return settings;
	}

	const cached = dimensionedSettingsSnapshots.get(settings);
	if (cached?.widthPx === widthPx && cached.heightPx === heightPx) {
		return cached.settings;
	}

	const dimensionedSettings: PreviewRenderSettings = Object.freeze({
		...settings,
		cardWidthPx: widthPx,
		cardHeightRatio,
	});
	dimensionedSettingsSnapshots.set(settings, {
		widthPx,
		heightPx,
		settings: dimensionedSettings,
	});
	return dimensionedSettings;
}

function normalizeDimension(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : Math.max(1, fallback);
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
