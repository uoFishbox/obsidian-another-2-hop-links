import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import { DEFAULT_SETTINGS, type PluginSettings } from "features/settings/model";
import {
	CACHE_KEY_SEPARATOR,
	buildRenderCacheKeyFromNormalizedQuery,
} from "./previewRenderKeys";
import { createPreviewOverrideIdentity } from "./previewRenderIdentity";

export type PreviewActivationSearchScope = "title-only" | "title-and-content";

/**
 * Builds the identity used to activate a concrete rendered card preview.
 */
export function buildCardPreviewActivationIdentity(
	file: TFile,
	settings: PluginSettings | undefined,
	normalizedSearchQuery: string,
	previewRenderVersion: string,
	previewRefreshToken: number,
	previewOverride: PreviewData | null,
): string {
	const previewOverrideIdentity = createPreviewOverrideIdentity(previewOverride);
	const renderVersionIdentity = `${previewRenderVersion}:${previewRefreshToken}:${previewOverrideIdentity}`;
	const renderCacheKey = buildRenderCacheKeyFromNormalizedQuery(
		file,
		normalizedSearchQuery,
		settings ?? DEFAULT_SETTINGS,
		renderVersionIdentity,
	);

	return `${renderCacheKey}${CACHE_KEY_SEPARATOR}${file.extension}`;
}
