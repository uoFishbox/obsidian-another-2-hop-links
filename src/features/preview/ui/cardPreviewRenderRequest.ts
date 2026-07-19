import type { TFile } from "obsidian";
import { createPreviewOverrideIdentity } from "features/preview/core/previewRenderIdentity";
import type { PreviewData } from "ui/context/linkContext";
import { DEFAULT_SETTINGS, type PluginSettings } from "features/settings/model";
import { buildPreviewRenderKeys } from "./cardPreviewSharedCache";

export interface CardPreviewRenderRequest {
	file: TFile;
	previewCacheRevision: string;
	previewContentIdentityKey: string;
	renderCacheKey: string;
	previewOverride: PreviewData | null;
	searchQuery: string;
	settings: PluginSettings;
}

export type CardPreviewRenderRequestResolver = (
	file: TFile | undefined,
	previewRefreshToken: number,
	previewOverride: PreviewData | null,
	previewRenderVersion: string,
	searchQuery: string,
	settings: PluginSettings,
) => CardPreviewRenderRequest | null;

/** Keeps request identity stable while all render-relevant inputs are unchanged. */
export function createCardPreviewRenderRequestResolver(): CardPreviewRenderRequestResolver {
	let lastRequest: CardPreviewRenderRequest | null = null;
	let lastDomOverride: PreviewData | null = null;

	return function resolve(
		file,
		previewRefreshToken,
		previewOverride,
		previewRenderVersion,
		searchQuery,
		pluginSettings,
	): CardPreviewRenderRequest | null {
		if (!file) {
			lastRequest = null;
			lastDomOverride = null;
			return null;
		}

		const settings = createPreviewRenderSettings(pluginSettings);
		const previewCacheRevision = `${previewRenderVersion}:${previewRefreshToken}`;
		const previewOverrideIdentity = createPreviewOverrideIdentity(previewOverride);
		const renderVersionIdentity = `${previewCacheRevision}:${previewOverrideIdentity}`;
		const { previewContentIdentityKey, renderCacheKey } = buildPreviewRenderKeys(
			file,
			searchQuery,
			settings,
			renderVersionIdentity,
		);
		const domOverride = previewOverride?.type === "dom" ? previewOverride : null;

		if (
			lastRequest?.renderCacheKey === renderCacheKey &&
			lastDomOverride === domOverride
		) {
			return lastRequest;
		}

		lastDomOverride = domOverride;
		lastRequest = {
			file,
			previewCacheRevision,
			previewContentIdentityKey,
			renderCacheKey,
			previewOverride,
			searchQuery,
			settings,
		};
		return lastRequest;
	};
}

function createPreviewRenderSettings(settings: PluginSettings): PluginSettings {
	return {
		...DEFAULT_SETTINGS,
		cardHeightRatio: settings.cardHeightRatio,
		cardWidthPx: settings.cardWidthPx,
		previewMaxChars: settings.previewMaxChars,
		previewMaxLines: settings.previewMaxLines,
		previewVisualLineSafetyMargin: settings.previewVisualLineSafetyMargin,
		priorityFrontmatterKeyForPreview: settings.priorityFrontmatterKeyForPreview,
		renderCodeBlockTypes: settings.renderCodeBlockTypes,
		searchPreviewSeekBufferChars: settings.searchPreviewSeekBufferChars,
		searchPreviewSeekThresholdChars: settings.searchPreviewSeekThresholdChars,
	};
}
