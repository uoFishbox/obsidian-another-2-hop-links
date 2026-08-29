/**
 * Stores the common singleton case without allocating a Set. A collection is
 * promoted to a Set when a second distinct value is added.
 */
export type CompactStringSet = string | Set<string>;

/** Read-only view of a compact string collection. */
export type ReadonlyCompactStringSet = string | ReadonlySet<string>;

/** Adds a value, promoting the singleton representation only when needed. */
export function addCompactStringSetValue(
	index: Map<string, CompactStringSet>,
	key: string,
	value: string,
): void {
	const existing = index.get(key);
	if (existing === undefined) {
		index.set(key, value);
		return;
	}

	if (typeof existing === "string") {
		if (existing === value) return;
		const values = new Set<string>();
		values.add(existing);
		values.add(value);
		index.set(key, values);
		return;
	}

	existing.add(value);
}

/** Removes a value without demoting a previously promoted Set. */
export function removeCompactStringSetValue(
	index: Map<string, CompactStringSet>,
	key: string,
	value: string,
): void {
	const existing = index.get(key);
	if (existing === undefined) return;

	if (typeof existing === "string") {
		if (existing === value) {
			index.delete(key);
		}
		return;
	}

	existing.delete(value);
	if (existing.size === 0) {
		index.delete(key);
	}
}

/** Returns the logical number of values in a compact collection. */
export function compactStringSetSize(collection: ReadonlyCompactStringSet): number {
	return typeof collection === "string" ? 1 : collection.size;
}

/** Returns the first value without allocating an iterator adapter. */
export function compactStringSetFirst(
	collection: ReadonlyCompactStringSet,
): string | undefined {
	return typeof collection === "string"
		? collection
		: collection.values().next().value;
}

/** Iterates over whole strings for both singleton and Set representations. */
export function* compactStringSetValues(
	collection: ReadonlyCompactStringSet,
): IterableIterator<string> {
	if (typeof collection === "string") {
		yield collection;
		return;
	}

	yield* collection;
}
