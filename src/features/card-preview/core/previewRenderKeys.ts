import type { TFile } from "obsidian";
import type {
	PreviewRenderSettings,
	PreviewRenderSettingsInput,
} from "./previewRenderSettings";

export const CACHE_KEY_SEPARATOR = "\0";
const SIGNATURE_SEP = "\u001f";

export interface PreviewSettingsSignatures {
	readonly contentSignature: string;
	readonly searchSignature: string;
}

const settingsSignatureCache = new WeakMap<object, PreviewSettingsSignatures>();

export function buildPreviewContentSettingsSignature(
	settings: PreviewRenderSettingsInput,
): string {
	return [
		settings.cardWidthPx,
		settings.cardHeightRatio,
		settings.priorityFrontmatterKeyForPreview ?? "",
		settings.previewMaxChars,
		settings.previewMaxLines,
		settings.previewVisualLineSafetyMargin,
	].join(SIGNATURE_SEP);
}

function buildSearchContextSettingsSignature(
	settings: PreviewRenderSettingsInput,
): string {
	return [
		settings.cardWidthPx,
		settings.cardHeightRatio,
		settings.previewMaxChars,
		settings.previewMaxLines,
		settings.previewVisualLineSafetyMargin,
		settings.searchPreviewSeekThresholdChars,
		settings.searchPreviewSeekBufferChars,
	].join(SIGNATURE_SEP);
}

export function getPreviewSettingsSignatures(
	settings: PreviewRenderSettingsInput,
): PreviewSettingsSignatures {
	const cached = settingsSignatureCache.get(settings);
	if (cached) {
		return cached;
	}

	const signatures = {
		contentSignature: buildPreviewContentSettingsSignature(settings),
		searchSignature: buildSearchContextSettingsSignature(settings),
	};
	settingsSignatureCache.set(settings, signatures);
	return signatures;
}

export function normalizePreviewQuery(query: string): string {
	return query.trim().toLowerCase();
}

export function buildPreviewRenderKeys(
	file: TFile,
	query: string,
	settings: PreviewRenderSettingsInput,
	previewRenderVersion: string,
): {
	renderCacheKey: string;
} {
	const { contentSignature, searchSignature } =
		getPreviewSettingsSignatures(settings);
	const normalizedQuery = normalizePreviewQuery(query);

	const renderKeyPrefix = `${file.path}${CACHE_KEY_SEPARATOR}${file.stat.mtime}${CACHE_KEY_SEPARATOR}${previewRenderVersion}${CACHE_KEY_SEPARATOR}${contentSignature}`;

	return {
		renderCacheKey: `${renderKeyPrefix}${CACHE_KEY_SEPARATOR}${normalizedQuery}${CACHE_KEY_SEPARATOR}${searchSignature}`,
	};
}
