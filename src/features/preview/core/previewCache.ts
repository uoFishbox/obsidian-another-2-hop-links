import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PluginSettings } from "types/settings";
import { createSizedLRUCache, stringBytes } from "utils/sizedLRUCache";
import type { SizedLRUCache } from "utils/sizedLRUCache";

const VIDEO_THUMBNAIL_CACHE_MAX_COUNT = 80;
const CACHE_KEY_SEPARATOR = "\0";
const SIGNATURE_SEP = "\u001f";

const PREVIEW_GENERATION_CACHE_MAX_BYTES = 2 * 1024 * 1024;

const MIN_BLOB_IMAGE_CACHE_CHARGE_BYTES = Math.max(
	1,
	Math.floor(PREVIEW_GENERATION_CACHE_MAX_BYTES / VIDEO_THUMBNAIL_CACHE_MAX_COUNT),
);

export type PreviewGenerationCache = SizedLRUCache<string, PreviewData>;

export function createPreviewGenerationCache(): PreviewGenerationCache {
	return createSizedLRUCache<string, PreviewData>(PREVIEW_GENERATION_CACHE_MAX_BYTES);
}

function buildPreviewContentSettingsSignature(settings?: PluginSettings): string {
	if (!settings) {
		return "";
	}

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

export function buildPreviewGenerationKey(
	file: TFile,
	settings?: PluginSettings,
	cacheRevision: number | string = "",
): string {
	return `${file.path}${CACHE_KEY_SEPARATOR}${file.stat.mtime}${CACHE_KEY_SEPARATOR}${cacheRevision}${CACHE_KEY_SEPARATOR}${buildPreviewContentSettingsSignature(settings)}`;
}

export function getPreviewDataSize(data: PreviewData): number {
	if (data.type === "image") {
		const byteSize = data.byteSize ?? stringBytes(data.content);
		if (data.content.startsWith("blob:")) {
			return Math.max(byteSize, MIN_BLOB_IMAGE_CACHE_CHARGE_BYTES);
		}
		return byteSize;
	}

	if (data.type === "text") {
		return stringBytes(data.content);
	}

	return 2048;
}

export function disposePreviewData(data: PreviewData): void {
	if (data.type === "image" && data.content.startsWith("blob:")) {
		URL.revokeObjectURL(data.content);
	}
}
