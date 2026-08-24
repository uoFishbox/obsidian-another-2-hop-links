/**
 * A bounded two-generation cache for cheap, high-frequency lookups.
 *
 * New entries live in the current generation. When it fills, it replaces the
 * previous generation. Reads from the previous generation promote entries so
 * hot keys survive rotations without the per-read reordering cost of an LRU.
 */
export interface BoundedGenerationalCache<K, V> {
	get(key: K): V | undefined;
	set(key: K, value: V): void;
}

export function createBoundedGenerationalCache<K, V>(
	maxEntries: number,
): BoundedGenerationalCache<K, V> {
	if (maxEntries <= 0) {
		throw new Error(
			`BoundedGenerationalCache maxEntries must be positive (got ${maxEntries})`,
		);
	}

	let current = new Map<K, V>();
	let previous = new Map<K, V>();

	function rotate(): void {
		previous = current;
		current = new Map<K, V>();
	}

	return {
		get(key: K): V | undefined {
			const fromCurrent = current.get(key);
			if (fromCurrent !== undefined) {
				return fromCurrent;
			}

			const fromPrevious = previous.get(key);
			if (fromPrevious === undefined) {
				return undefined;
			}

			previous.delete(key);
			current.set(key, fromPrevious);
			if (current.size >= maxEntries) {
				rotate();
			}
			return fromPrevious;
		},

		set(key: K, value: V): void {
			current.set(key, value);
			if (current.size >= maxEntries) {
				rotate();
			}
		},
	};
}
