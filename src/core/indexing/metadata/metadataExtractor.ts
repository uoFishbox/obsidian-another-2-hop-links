import type { CachedMetadata } from "obsidian";
import type {
	CachedMetadataWithLinkReferences,
	LinkReference,
	TagReference,
} from "types/domain";

const EMPTY_TAGS: readonly TagReference[] = [];
const EMPTY_LINK_REFERENCES: readonly LinkReference[] = [];

export function extractTags(cache: CachedMetadata | null): readonly TagReference[] {
	if (!cache) {
		return EMPTY_TAGS;
	}

	if (!cache.frontmatter?.tags && (!cache.tags || cache.tags.length === 0)) {
		return EMPTY_TAGS;
	}

	if (!cache.frontmatter?.tags && cache.tags?.length === 1) {
		const tagCache = cache.tags[0];
		const normalized = normalizeTag(tagCache.tag);
		return normalized
			? [{ tag: normalized, position: tagCache.position }]
			: EMPTY_TAGS;
	}

	const frontmatterTags = cache.frontmatter?.tags;
	if (
		Array.isArray(frontmatterTags) &&
		frontmatterTags.length === 1 &&
		(!cache.tags || cache.tags.length === 0)
	) {
		const tag = frontmatterTags[0];
		const normalized = typeof tag === "string" ? normalizeTag(tag) : "";
		return normalized ? [{ tag: normalized }] : EMPTY_TAGS;
	}

	const tagsMap = new Map<string, TagReference>();

	// 1. フロントマターのタグを処理 (位置情報なし)
	if (frontmatterTags) {
		if (Array.isArray(frontmatterTags)) {
			for (const tag of frontmatterTags) {
				// Obsidian 1.9+: string-form tags (`tags: foo, bar`) are not
				// recognized by the app. Only array-form counts.
				if (typeof tag !== "string") continue;

				const normalized = normalizeTag(tag);
				if (normalized && !tagsMap.has(normalized)) {
					tagsMap.set(normalized, { tag: normalized });
				}
			}
		}
	}

	// 2. 本文中のタグを処理 (位置情報あり)
	if (cache.tags) {
		// cache.tags は TagCache[] 型
		for (const tagCache of cache.tags) {
			const normalized = normalizeTag(tagCache.tag);
			// 既に同じタグが登録されていても、位置情報を持つこちらを優先する
			if (normalized) {
				tagsMap.set(normalized, {
					tag: normalized,
					position: tagCache.position,
				});
			}
		}
	}

	return Array.from(tagsMap.values());
}

export function collectLinkReferences(
	cache: CachedMetadataWithLinkReferences | null,
): readonly LinkReference[] {
	if (!cache) {
		return EMPTY_LINK_REFERENCES;
	}

	const links = cache.links ?? [];
	const embeds = cache.embeds ?? [];
	const frontmatterLinks = cache.frontmatterLinks ?? [];
	const totalCount = links.length + embeds.length + frontmatterLinks.length;
	if (totalCount === 0) {
		return EMPTY_LINK_REFERENCES;
	}

	// if there's only one type of reference, return it directly for efficiency
	if (links.length === totalCount) {
		return links;
	}
	if (embeds.length === totalCount) {
		return embeds;
	}
	if (frontmatterLinks.length === totalCount) {
		return frontmatterLinks;
	}

	const allRefs = new Array<LinkReference>(totalCount);
	let index = 0;
	for (let i = 0; i < links.length; i++) {
		allRefs[index++] = links[i];
	}
	for (let i = 0; i < embeds.length; i++) {
		allRefs[index++] = embeds[i];
	}
	for (let i = 0; i < frontmatterLinks.length; i++) {
		allRefs[index++] = frontmatterLinks[i];
	}

	return allRefs.sort((a, b) => {
		// positionプロパティがない場合（Frontmatterなど）は先頭(-1)とみなす
		const offsetA = "position" in a ? (a.position?.start.offset ?? -1) : -1;
		const offsetB = "position" in b ? (b.position?.start.offset ?? -1) : -1;

		return offsetA - offsetB;
	});
}

/**
 * リンク参照をソートせずに走査する。
 * 順序が不要な用途（集計・インデックス更新）向け。
 */
export function forEachLinkReferenceUnordered(
	cache: CachedMetadataWithLinkReferences | null,
	visitor: (reference: LinkReference) => void,
): void {
	if (!cache) {
		return;
	}

	if (cache.links) {
		const references = cache.links;
		for (let i = 0; i < references.length; i++) {
			visitor(references[i]);
		}
	}
	if (cache.embeds) {
		const references = cache.embeds;
		for (let i = 0; i < references.length; i++) {
			visitor(references[i]);
		}
	}
	if (cache.frontmatterLinks) {
		const references = cache.frontmatterLinks;
		for (let i = 0; i < references.length; i++) {
			visitor(references[i]);
		}
	}
}

export function countLinkReferences(
	cache: CachedMetadataWithLinkReferences | null,
): number {
	if (!cache) return 0;
	let count = 0;
	if (cache.links) count += cache.links.length;
	if (cache.embeds) count += cache.embeds.length;
	if (cache.frontmatterLinks) count += cache.frontmatterLinks.length;
	return count;
}

function normalizeTag(tag: string): string {
	if (!tag) return "";
	let normalized = tag;
	if (normalized.charCodeAt(0) === 35 /* # */) {
		normalized = normalized.substring(1);
	}
	return normalized.toLowerCase().trim();
}
