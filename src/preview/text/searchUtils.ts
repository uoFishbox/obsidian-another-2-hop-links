import { getSearchQueryTerms } from "search/searchQueryTerms";

const REGEXP_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;
const REGEXP_SOURCE_CACHE_MAX_SIZE = 64;
const REGEXP_OBJECT_CACHE_MAX_SIZE = 64;
const regexpSourceCache = new Map<string, string | null>();
const regexpObjectCache = new Map<string, RegExp>();

function escapeRegExp(value: string): string {
	return value.replace(REGEXP_ESCAPE_PATTERN, "\\$&");
}

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
			terms[index] = escapeRegExp(terms[index]);
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
 * rendered HTML の visible text 内に needle が含まれるかを判定する。
 * タグを除いた短い preview 文字列へ変換し、ネイティブ文字列検索を使う。
 *
 * **注意**: rendered HTML 専用。raw markdown には使わないこと。
 * raw markdown の backtick 内 `<tag>` は visible text だが、
 * この関数は `<` をタグ開始と見なして skip してしまう。
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
