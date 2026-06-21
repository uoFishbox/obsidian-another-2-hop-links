export function useSearchQuery(delayMs: number = 150) {
	let inputValue = $state("");
	let debouncedQuery = $state("");
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const value = inputValue;

		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}

		searchTimeout = setTimeout(() => {
			debouncedQuery = value;
		}, delayMs);

		return () => {
			if (searchTimeout) {
				clearTimeout(searchTimeout);
			}
		};
	});

	let normalizedQuery = $derived(debouncedQuery.trim().toLowerCase());

	return {
		get value() {
			return inputValue;
		},
		set value(v: string) {
			inputValue = v;
		},
		get debounced() {
			return debouncedQuery;
		},
		get normalized() {
			return normalizedQuery;
		},
	};
}
