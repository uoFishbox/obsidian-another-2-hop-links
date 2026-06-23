import { getSearchQueryTerms } from "features/search/searchQueryTerms";

const REGEXP_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;
const REGEXP_SOURCE_CACHE_MAX_SIZE = 64;
const REGEXP_OBJECT_CACHE_MAX_SIZE = 64;
const regexpSourceCache = new Map<string, string | null>();
const regexpObjectCache = new Map<string, RegExp>();

export function escapeRegExp(value: string): string {
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
	const source =
		terms.length === 0
			? null
			: [...terms]
					.sort((a, b) => b.length - a.length)
					.map(escapeRegExp)
					.join("|");

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

/**
 * rendered HTML の visible text 内に needle が含まれるかを中間文字列なしで判定する。
 * `<...>` タグを skip しながら streaming に大文字小文字不一致検索を行う。
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

	const needle = normalizedQuery;
	const needleLen = needle.length;
	const len = html.length;
	let i = 0;

	while (i < len) {
		// Skip HTML tags
		if (html[i] === "<") {
			const closeIndex = html.indexOf(">", i + 1);
			if (closeIndex !== -1) {
				i = closeIndex + 1;
				continue;
			}
			// 閉じ `>` がなければタグではなく visible text の `<`
		}

		// Try matching needle starting at position i
		let j = 0;
		let k = i;
		while (j < needleLen && k < len) {
			if (html[k] === "<") {
				const closeIndex = html.indexOf(">", k + 1);
				if (closeIndex !== -1) {
					k = closeIndex + 1;
					continue;
				}
			}
			if (html[k].toLowerCase() !== needle[j]) {
				break;
			}
			j++;
			k++;
		}

		if (j === needleLen) {
			return true;
		}

		i++;
	}

	return false;
}
