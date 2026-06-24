import type { TFile } from "obsidian";
import type { PluginSettings } from "types/settings";

export const CACHE_KEY_SEPARATOR = "\0";
const SIGNATURE_SEP = "\u001f";

export function buildPreviewContentSettingsSignature(settings: PluginSettings): string {
	const renderCodeBlockTypes = settings.renderCodeBlockTypes ?? [];
	return [
		settings.priorityFrontmatterKeyForPreview ?? "",
		settings.previewMaxChars,
		settings.previewMaxLines,
		settings.previewVisualLineSafetyMargin,
		renderCodeBlockTypes.length,
		...renderCodeBlockTypes,
	].join(SIGNATURE_SEP);
}

export function buildSearchContextSettingsSignature(settings: PluginSettings): string {
	return [
		settings.previewMaxChars,
		settings.previewMaxLines,
		settings.previewVisualLineSafetyMargin,
		settings.searchPreviewSeekThresholdChars,
		settings.searchPreviewSeekBufferChars,
	].join(SIGNATURE_SEP);
}

export function normalizePreviewQuery(query: string): string {
	return query.trim().toLowerCase();
}

export function buildPreviewContentIdentityKey(
	file: TFile,
	settings: PluginSettings,
	previewRenderVersion: string,
): string {
	return `${file.path}${CACHE_KEY_SEPARATOR}${file.stat.mtime}${CACHE_KEY_SEPARATOR}${previewRenderVersion}${CACHE_KEY_SEPARATOR}${buildPreviewContentSettingsSignature(settings)}`;
}

export function buildRenderCacheKey(
	file: TFile,
	query: string,
	settings: PluginSettings,
	previewRenderVersion: string,
): string {
	return `${buildPreviewContentIdentityKey(file, settings, previewRenderVersion)}${CACHE_KEY_SEPARATOR}${normalizePreviewQuery(query)}${CACHE_KEY_SEPARATOR}${buildSearchContextSettingsSignature(settings)}`;
}

export function buildPreviewRenderKeys(
	file: TFile,
	query: string,
	settings: PluginSettings,
	previewRenderVersion: string,
): {
	previewContentIdentityKey: string;
	renderCacheKey: string;
	normalizedQuery: string;
} {
	const contentSignature = buildPreviewContentSettingsSignature(settings);
	const searchSignature = buildSearchContextSettingsSignature(settings);
	const normalizedQuery = normalizePreviewQuery(query);

	const previewContentIdentityKey = `${file.path}${CACHE_KEY_SEPARATOR}${file.stat.mtime}${CACHE_KEY_SEPARATOR}${previewRenderVersion}${CACHE_KEY_SEPARATOR}${contentSignature}`;

	return {
		previewContentIdentityKey,
		renderCacheKey: `${previewContentIdentityKey}${CACHE_KEY_SEPARATOR}${normalizedQuery}${CACHE_KEY_SEPARATOR}${searchSignature}`,
		normalizedQuery,
	};
}
