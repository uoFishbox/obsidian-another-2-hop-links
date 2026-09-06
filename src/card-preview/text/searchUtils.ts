import {
	buildWikiLinkInsensitiveLiteralSource,
	getSearchQueryTerms,
} from "search/searchQueryTerms";

const REGEXP_SOURCE_CACHE_MAX_SIZE = 64;
const REGEXP_OBJECT_CACHE_MAX_SIZE = 64;
const regexpSourceCache = new Map<string, string | null>();
const regexpObjectCache = new Map<string, RegExp>();

function getCachedRegExpObject(source: string): RegExp {
	const cached = regexpObjectCache.get(source);
	if (cached) {
		regexpObjectCache.delete(source);
		cached.lastIndex = 0;
		regexpObjectCache.set(source, cached);
		return cached;
	}

	const pattern = new RegExp(source, "i");
	regexpObjectCache.set(source, pattern);
	if (regexpObjectCache.size > REGEXP_OBJECT_CACHE_MAX_SIZE) {
		const oldestKey = regexpObjectCache.keys().next().value;
		if (oldestKey !== undefined) {
			regexpObjectCache.delete(oldestKey);
		}
	}

	return pattern;
}

export function createCaseInsensitiveRegExp(
	query: string | undefined,
	global = false,
): RegExp | null {
	const source = getCachedRegExpSource(query);
	if (!source) {
		return null;
	}

	if (global) {
		return new RegExp(source, "gi");
	}

	return getCachedRegExpObject(source);
}

function getCachedRegExpSource(query: string | undefined): string | null {
	const cacheKey = query ?? "";
	const cachedSource = regexpSourceCache.get(cacheKey);
	if (cachedSource !== undefined) {
		regexpSourceCache.delete(cacheKey);
		regexpSourceCache.set(cacheKey, cachedSource);
		return cachedSource;
	}

	const terms = getSearchQueryTerms(query);
	let source: string | null = null;
	if (terms.length > 0) {
		terms.sort((a, b) => b.length - a.length);
		for (let index = 0; index < terms.length; index += 1) {
			terms[index] = buildWikiLinkInsensitiveLiteralSource(terms[index]);
		}
		source = terms.join("|");
	}

	regexpSourceCache.set(cacheKey, source);
	if (regexpSourceCache.size > REGEXP_SOURCE_CACHE_MAX_SIZE) {
		const oldestKey = regexpSourceCache.keys().next().value;
		if (oldestKey !== undefined) {
			regexpSourceCache.delete(oldestKey);
		}
	}

	return source;
}

export function findCaseInsensitiveIndex(
	text: string,
	query: string | undefined,
): number {
	const pattern = createCaseInsensitiveRegExp(query);
	if (!pattern) {
		return -1;
	}

	const match = pattern.exec(text);
	return match?.index ?? -1;
}

function collectVisibleHtmlText(html: string): string {
	let tagStart = html.indexOf("<");
	if (tagStart === -1) return html;

	const parts: string[] = [];
	let cursor = 0;

	while (tagStart !== -1) {
		const tagEnd = html.indexOf(">", tagStart + 1);
		if (tagEnd === -1) break;

		if (tagStart > cursor) {
			parts.push(html.substring(cursor, tagStart));
		}
		cursor = tagEnd + 1;
		tagStart = html.indexOf("<", cursor);
	}

	if (cursor === 0) return html;
	if (cursor < html.length) parts.push(html.substring(cursor));
	return parts.join("");
}

/**
 * Determine whether needle is included in the visible text of rendered HTML.
 * Convert it to a short preview string with tags removed and use native string search.
 *
 * **Note**: For rendered HTML only. Do not use with raw markdown.
 * A `<tag>` inside backticks in raw markdown is visible text, but
 * this function skips it because it treats `<` as the start of a tag.
 */
export function htmlVisibleTextContainsCaseInsensitive(
	html: string,
	normalizedQuery: string,
): boolean {
	if (!normalizedQuery) {
		return false;
	}

	return collectVisibleHtmlText(html).toLowerCase().includes(normalizedQuery);
}
