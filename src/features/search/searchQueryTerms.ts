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
