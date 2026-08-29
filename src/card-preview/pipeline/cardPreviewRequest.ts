import type { TFile } from "obsidian";
import type { PluginSettings } from "settings/model";
import type { PreviewData } from "card-preview/types";
import { buildPreviewRenderKey } from "./previewRenderKeys";
import {
	applyPreviewCardDimensions,
	createPreviewRenderSettings,
	type PreviewCardDimensions,
	type PreviewRenderSettings,
} from "./previewRenderSettings";

type DomPreviewOverride = Extract<PreviewData, { type: "dom" }>;

const FNV1A32_OFFSET = 0x811c9dc5;
const FNV1A32_PRIME = 0x01000193;
const domPreviewOverrideIds = new WeakMap<DomPreviewOverride, number>();
let nextDomPreviewOverrideId = 1;
const dimensionedRequestSnapshots = new WeakMap<
	CardPreviewRequest,
	{
		readonly settings: PreviewRenderSettings;
		readonly request: CardPreviewRequest;
	}
>();

function hashPreviewContent(content: string): string {
	let hash = FNV1A32_OFFSET;
	for (let index = 0; index < content.length; index += 1) {
		hash ^= content.charCodeAt(index);
		hash = Math.imul(hash, FNV1A32_PRIME);
	}
	return `${content.length}:${(hash >>> 0).toString(36)}`;
}

function getDomPreviewOverrideId(preview: DomPreviewOverride): number {
	const existing = domPreviewOverrideIds.get(preview);
	if (existing !== undefined) return existing;
	const nextId = nextDomPreviewOverrideId++;
	domPreviewOverrideIds.set(preview, nextId);
	return nextId;
}

export function createPreviewOverrideIdentity(preview: PreviewData | null): string {
	if (!preview) return "none";
	if (preview.type !== "dom") {
		return `${preview.type}:${hashPreviewContent(preview.content)}`;
	}
	return `${preview.type}:${getDomPreviewOverrideId(preview)}`;
}

/** Complete immutable value required to render one card preview. */
export interface CardPreviewRequest {
	readonly renderKey: string;
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
	const renderKey = buildPreviewRenderKey(
		params.file,
		params.searchQuery,
		settings,
		renderRevision,
	);

	return Object.freeze({
		renderKey,
		previewCacheRevision,
		file: params.file,
		searchQuery: params.searchQuery,
		previewOverride: params.previewOverride,
		settings,
	});
}

/** Applies resolved grid geometry without reading layout from each card DOM node. */
export function applyCardPreviewDimensions(
	request: CardPreviewRequest,
	dimensions: PreviewCardDimensions,
): CardPreviewRequest {
	const settings = applyPreviewCardDimensions(request.settings, dimensions);
	if (settings === request.settings) return request;

	const cached = dimensionedRequestSnapshots.get(request);
	if (cached?.settings === settings) return cached.request;

	const previewOverrideIdentity = createPreviewOverrideIdentity(
		request.previewOverride,
	);
	const renderRevision = `${request.previewCacheRevision}:${previewOverrideIdentity}`;
	const dimensionedRequest: CardPreviewRequest = Object.freeze({
		...request,
		renderKey: buildPreviewRenderKey(
			request.file,
			request.searchQuery,
			settings,
			renderRevision,
		),
		settings,
	});
	dimensionedRequestSnapshots.set(request, {
		settings,
		request: dimensionedRequest,
	});
	return dimensionedRequest;
}
