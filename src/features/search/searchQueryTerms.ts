export function getSearchQueryTerms(query: string | undefined): string[] {
	const normalizedQuery = query?.trim().toLowerCase() ?? "";
	if (!normalizedQuery) {
		return [];
	}

	const terms = normalizedQuery.split(/\s+/u);
	const uniqueTerms: string[] = [];
	for (let i = 0; i < terms.length; i++) {
		const term = terms[i];
		// 検索語句の数は通常数個〜十数個程度なので includes で十分高速
		if (term && !uniqueTerms.includes(term)) {
			uniqueTerms.push(term);
		}
	}
	return uniqueTerms;
}
