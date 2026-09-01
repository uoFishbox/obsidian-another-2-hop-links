const REGEXP_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;
const WIKILINK_DELIMITER_PATTERN = "(?:\\[\\[|\\]\\])*";

export function getSearchQueryTerms(query: string | undefined): string[] {
	const normalizedQuery = query?.trim().toLowerCase() ?? "";
	if (!normalizedQuery) {
		return [];
	}

	const terms = normalizedQuery.split(/\s+/u);
	const uniqueTerms: string[] = [];
	for (let i = 0; i < terms.length; i++) {
		const term = terms[i];
		if (term && !uniqueTerms.includes(term)) {
			uniqueTerms.push(term);
		}
	}
	return uniqueTerms;
}

/** Builds a literal RegExp source that treats WikiLink delimiters as invisible. */
export function buildWikiLinkInsensitiveLiteralSource(term: string): string {
	return Array.from(term, (character) =>
		character.replace(REGEXP_ESCAPE_PATTERN, "\\$&"),
	).join(WIKILINK_DELIMITER_PATTERN);
}
