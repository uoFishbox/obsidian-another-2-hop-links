import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import { DEFAULT_SETTINGS, type PluginSettings } from "types/settings";
import { buildPreviewRenderKeys } from "ui/components/common/cardPreviewSharedCache";
import { createPreviewOverrideIdentity } from "./previewRenderIdentity";

export type PreviewActivationSearchScope = "title-only" | "title-and-content";

export interface CardPreviewActivationIdentityInput {
	readonly file: TFile;
	readonly settings?: PluginSettings;
	readonly searchQuery: string;
	readonly searchScope: PreviewActivationSearchScope;
	readonly previewRenderVersion: string;
	readonly previewRefreshToken: number;
	readonly previewOverride: PreviewData | null;
}

/**
 * Builds the identity used to activate a concrete rendered card preview.
 */
export function buildCardPreviewActivationIdentity(
	input: CardPreviewActivationIdentityInput,
): string {
	const effectiveSearchQuery =
		input.searchScope === "title-only" ? "" : input.searchQuery;
	const previewOverrideIdentity = createPreviewOverrideIdentity(
		input.previewOverride,
	);
	const renderVersionIdentity = `${input.previewRenderVersion}:${input.previewRefreshToken}:${previewOverrideIdentity}`;
	const { renderCacheKey } = buildPreviewRenderKeys(
		input.file,
		effectiveSearchQuery,
		input.settings ?? DEFAULT_SETTINGS,
		renderVersionIdentity,
	);

	return [
		renderCacheKey,
		input.searchScope,
		input.file.extension,
	].join("\0");
}
