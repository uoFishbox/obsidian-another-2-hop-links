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
	const renderCodeBlockTypes = settings.renderCodeBlockTypes ?? [];
	return [
		settings.cardWidthPx,
		settings.cardHeightRatio,
		settings.priorityFrontmatterKeyForPreview ?? "",
		settings.previewMaxChars,
		settings.previewMaxLines,
		settings.previewVisualLineSafetyMargin,
		renderCodeBlockTypes.length,
		...renderCodeBlockTypes,
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

export function buildPreviewContentIdentityKey(
	file: TFile,
	settings: PreviewRenderSettingsInput,
	previewRenderVersion: string,
): string {
	const { contentSignature } = getPreviewSettingsSignatures(settings);
	return `${file.path}${CACHE_KEY_SEPARATOR}${file.stat.mtime}${CACHE_KEY_SEPARATOR}${previewRenderVersion}${CACHE_KEY_SEPARATOR}${contentSignature}`;
}

export function buildRenderCacheKey(
	file: TFile,
	query: string,
	settings: PreviewRenderSettingsInput,
	previewRenderVersion: string,
): string {
	const { searchSignature } = getPreviewSettingsSignatures(settings);
	return `${buildPreviewContentIdentityKey(file, settings, previewRenderVersion)}${CACHE_KEY_SEPARATOR}${normalizePreviewQuery(query)}${CACHE_KEY_SEPARATOR}${searchSignature}`;
}

export function buildRenderCacheKeyFromNormalizedQuery(
	file: TFile,
	normalizedQuery: string,
	settings: PreviewRenderSettingsInput,
	previewRenderVersion: string,
): string {
	const { contentSignature, searchSignature } =
		getPreviewSettingsSignatures(settings);
	return `${file.path}${CACHE_KEY_SEPARATOR}${file.stat.mtime}${CACHE_KEY_SEPARATOR}${previewRenderVersion}${CACHE_KEY_SEPARATOR}${contentSignature}${CACHE_KEY_SEPARATOR}${normalizedQuery}${CACHE_KEY_SEPARATOR}${searchSignature}`;
}

export function buildPreviewRenderKeys(
	file: TFile,
	query: string,
	settings: PreviewRenderSettingsInput,
	previewRenderVersion: string,
): {
	previewContentIdentityKey: string;
	renderCacheKey: string;
	normalizedQuery: string;
} {
	const { contentSignature, searchSignature } =
		getPreviewSettingsSignatures(settings);
	const normalizedQuery = normalizePreviewQuery(query);

	const previewContentIdentityKey = `${file.path}${CACHE_KEY_SEPARATOR}${file.stat.mtime}${CACHE_KEY_SEPARATOR}${previewRenderVersion}${CACHE_KEY_SEPARATOR}${contentSignature}`;

	return {
		previewContentIdentityKey,
		renderCacheKey: `${previewContentIdentityKey}${CACHE_KEY_SEPARATOR}${normalizedQuery}${CACHE_KEY_SEPARATOR}${searchSignature}`,
		normalizedQuery,
	};
}
