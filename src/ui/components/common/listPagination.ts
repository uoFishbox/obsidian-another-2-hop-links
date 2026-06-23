export function computeInitialVisibleCount(
	totalCount: number,
	preferredCount: number | undefined,
): number {
	if (preferredCount == undefined || Number.isNaN(preferredCount)) {
		return totalCount;
	}

	const normalized = Math.max(0, Math.floor(preferredCount));
	return Math.min(totalCount, normalized);
}

export function normalizeIncrement(value: number | undefined): number {
	const normalized = Math.floor(value ?? Number.POSITIVE_INFINITY);
	if (!Number.isFinite(normalized) || normalized <= 0) {
		return Number.POSITIVE_INFINITY;
	}

	return normalized;
}

const SECTION_ID_PREFIX = "s:";
const FNV1A32_OFFSET = 0x811c9dc5;
const FNV1A32_PRIME = 0x01000193;

export const SHOULD_VALIDATE_SECTION_IDS = process.env.NODE_ENV !== "production";

function updateFnv1a32(hash: number, value: string): number {
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, FNV1A32_PRIME);
	}
	return hash >>> 0;
}

function updateFnv1a32Char(hash: number, charCode: number): number {
	hash ^= charCode;
	return Math.imul(hash, FNV1A32_PRIME) >>> 0;
}

function fnv1a32(value: string, seed = FNV1A32_OFFSET): number {
	return updateFnv1a32(seed, value);
}

export function createCompactSectionId(prefix: string, identity: string): string {
	const primaryHash = fnv1a32(identity);
	const secondaryHash = fnv1a32(identity, 0x9e3779b9);
	return `${prefix}-${primaryHash.toString(36)}-${secondaryHash.toString(36)}`;
}

export function buildScopedSectionId(
	sectionId: string,
	scope: string | null | undefined,
): string {
	const normalizedScope = scope?.trim() ?? "";
	if (normalizedScope === "") {
		return sectionId;
	}

	let hash = updateFnv1a32(FNV1A32_OFFSET, sectionId);
	hash = updateFnv1a32Char(hash, 0);
	hash = updateFnv1a32(hash, normalizedScope);
	return `${SECTION_ID_PREFIX}${hash.toString(36)}`;
}
