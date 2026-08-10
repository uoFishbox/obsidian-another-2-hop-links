import type { TFile } from "obsidian";
import type { PluginSettings } from "features/settings/model";
import type { PreviewData } from "features/card-preview/public-types";
import { createPreviewOverrideIdentity } from "./previewRenderIdentity";
import { buildPreviewRenderKeys } from "./previewRenderKeys";
import {
	createPreviewRenderSettings,
	type PreviewRenderSettings,
} from "./previewRenderSettings";

/** Complete immutable value required to render one card preview. */
export interface CardPreviewRequest {
	readonly renderKey: string;
	readonly previewContentKey: string;
	readonly previewCacheRevision: string;
	readonly file: TFile;
	readonly searchQuery: string;
	readonly previewOverride: PreviewData | null;
	readonly settings: PreviewRenderSettings;
}

export interface CompileCardPreviewRequestParams {
	readonly file: TFile;
	readonly searchQuery: string;
	readonly previewOverride: PreviewData | null;
	readonly previewRenderVersion: string;
	readonly settings: PluginSettings;
}

/** Compiles ambient model inputs into one atomically-consistent request. */
export function compileCardPreviewRequest(
	params: CompileCardPreviewRequestParams,
): CardPreviewRequest {
	const settings = createPreviewRenderSettings(params.settings);
	const previewOverrideIdentity = createPreviewOverrideIdentity(
		params.previewOverride,
	);
	const previewCacheRevision = params.previewRenderVersion;
	const renderRevision = `${previewCacheRevision}:${previewOverrideIdentity}`;
	const keys = buildPreviewRenderKeys(
		params.file,
		params.searchQuery,
		settings,
		renderRevision,
	);

	return Object.freeze({
		renderKey: keys.renderCacheKey,
		previewContentKey: keys.previewContentIdentityKey,
		previewCacheRevision,
		file: params.file,
		searchQuery: params.searchQuery,
		previewOverride: params.previewOverride,
		settings,
	});
}
