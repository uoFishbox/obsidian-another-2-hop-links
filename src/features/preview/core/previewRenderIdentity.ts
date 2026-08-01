import type { PreviewData } from "../public-types";

type DomPreviewOverride = Extract<PreviewData, { type: "dom" }>;

const FNV1A32_OFFSET = 0x811c9dc5;
const FNV1A32_PRIME = 0x01000193;

const domPreviewOverrideIds = new WeakMap<DomPreviewOverride, number>();
let nextDomPreviewOverrideId = 1;

function hashString(content: string): string {
	let hash = FNV1A32_OFFSET;
	for (let i = 0; i < content.length; i += 1) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, FNV1A32_PRIME);
	}

	return `${content.length}:${(hash >>> 0).toString(36)}`;
}

function getDomPreviewOverrideId(preview: DomPreviewOverride): number {
	const existing = domPreviewOverrideIds.get(preview);
	if (existing !== undefined) {
		return existing;
	}

	const nextId = nextDomPreviewOverrideId;
	nextDomPreviewOverrideId += 1;
	domPreviewOverrideIds.set(preview, nextId);
	return nextId;
}

/**
 * Creates a stable identity string for a preview override value.
 *
 * This is used to distinguish preview render requests that share the same
 * underlying file and cache revision but differ in override content, such as
 * a search-generated content preview.
 */
export function createPreviewOverrideIdentity(preview: PreviewData | null): string {
	if (!preview) {
		return "none";
	}

	if (
		preview.type === "text" ||
		preview.type === "image" ||
		preview.type === "empty"
	) {
		return `${preview.type}:${hashString(preview.content)}`;
	}

	return `${preview.type}:${getDomPreviewOverrideId(preview)}`;
}
