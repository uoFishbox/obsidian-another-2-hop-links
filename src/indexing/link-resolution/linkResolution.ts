import { getLinkpath, normalizePath } from "obsidian";
import type { IndexedLink, LinkReference, LinkResolution } from "indexing/model";
import type { IMetadataCache } from "obsidian-integration/hostContracts";
import {
	createBoundedGenerationalCache,
	type BoundedGenerationalCache,
} from "shared/cache/boundedGenerationalCache";

const HAS_EXTENSION_RE = /\.[a-z0-9]+$/i;
const LINK_NORMALIZATION_CACHE_MAX_ENTRIES = 8192;
const CASE_INSENSITIVE_LOOKUP_KEY_CACHE: BoundedGenerationalCache<string, string> =
	createBoundedGenerationalCache(LINK_NORMALIZATION_CACHE_MAX_ENTRIES);
const RAW_LINKPATH_TO_MARKDOWN_PATH_CACHE: BoundedGenerationalCache<string, string> =
	createBoundedGenerationalCache(LINK_NORMALIZATION_CACHE_MAX_ENTRIES);
const LINK_TEXT_TO_MARKDOWN_PATH_CACHE: BoundedGenerationalCache<string, string> =
	createBoundedGenerationalCache(LINK_NORMALIZATION_CACHE_MAX_ENTRIES);

export function toCaseInsensitiveLookupKey(path: string): string {
	const cached = CASE_INSENSITIVE_LOOKUP_KEY_CACHE.get(path);
	if (cached !== undefined) return cached;
	const normalized = path.indexOf("\\") === -1 ? path : normalizePath(path);
	const lookupKey = normalized.toLowerCase();
	CASE_INSENSITIVE_LOOKUP_KEY_CACHE.set(path, lookupKey);
	return lookupKey;
}

export function normalizeLinkToMarkdownPath(linkText: string): string {
	const cached = LINK_TEXT_TO_MARKDOWN_PATH_CACHE.get(linkText);
	if (cached !== undefined) return cached;
	const markdownPath = normalizeRawLinkpathToMarkdownPath(getLinkpath(linkText));
	LINK_TEXT_TO_MARKDOWN_PATH_CACHE.set(linkText, markdownPath);
	return markdownPath;
}

export function stripLinkAnchor(linkText: string): string {
	const anchorIndex = linkText.indexOf("#");
	return anchorIndex >= 0 ? linkText.slice(0, anchorIndex) : linkText;
}

export function normalizeHrefToLookupPath(href: string): string {
	return normalizeLinkToMarkdownPath(stripLinkAnchor(href));
}

export function normalizeRawLinkpathToMarkdownPath(rawPath: string): string {
	const cached = RAW_LINKPATH_TO_MARKDOWN_PATH_CACHE.get(rawPath);
	if (cached !== undefined) return cached;
	const normalized = normalizePath(rawPath);
	const markdownPath = HAS_EXTENSION_RE.test(normalized)
		? normalized
		: `${normalized}.md`;
	RAW_LINKPATH_TO_MARKDOWN_PATH_CACHE.set(rawPath, markdownPath);
	return markdownPath;
}

export function getLookupPathForLink(link: IndexedLink): string {
	if (link.lookupPath) return link.lookupPath;
	if (link.path) return link.path;
	return normalizeLinkToMarkdownPath(link.rawText);
}

export function resolveLinkDestination(
	metadataCache: IMetadataCache,
	link: LinkReference,
	sourcePath: string,
): LinkResolution {
	const rawLinkPath = getLinkpath(link.link);
	const destination = metadataCache.getFirstLinkpathDest(rawLinkPath, sourcePath);
	if (destination) {
		return {
			file: destination,
			lookupPath: destination.path,
			isUnresolved: false,
		};
	}
	return {
		file: null,
		lookupPath: normalizeRawLinkpathToMarkdownPath(rawLinkPath),
		isUnresolved: true,
	};
}
