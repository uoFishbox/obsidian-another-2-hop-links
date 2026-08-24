export interface SearchQueryOptions {
	/** Delay before exposing the normalized query to search processing. */
	delayMs?: number;
	/** Value restored when the search control is mounted. */
	initialValue?: string;
	/** Persists each immediate input change outside the component. */
	onInputChange?: (value: string) => void;
}

export function useSearchQuery(options: SearchQueryOptions = {}) {
	const delayMs = options.delayMs ?? 150;
	const initialValue = options.initialValue ?? "";
	let inputValue = $state(initialValue);
	let debouncedQuery = $state(initialValue);
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
		set value(value: string) {
			inputValue = value;
			options.onInputChange?.(value);
		},
		get debounced() {
			return debouncedQuery;
		},
		get normalized() {
			return normalizedQuery;
		},
	};
}
