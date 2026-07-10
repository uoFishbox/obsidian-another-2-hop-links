/**
 * A bounded two-generation cache for cheap, high-frequency lookups.
 *
 * Normalization caches (link path -> markdown path, case-insensitive lookup
 * keys) receive repeated reads of a small hot set plus a long tail of one-off
 * strings. A strict LRU pays a `delete`/`set` on every access to re-order
 * entries, which is wasteful when the normalized value itself is cheap to
 * recompute. Instead we keep two generations:
 *
 * - `current`: newly inserted entries live here. Reads are a single
 *   `Map.get` with no bookkeeping.
 * - `previous`: the prior `current` generation, retained so that keys touched
 *   just before a rotation still hit until the next rotation.
 *
 * When `current` reaches `maxEntries`, it becomes `previous` and a fresh
 * `current` starts. Entries found in `previous` are promoted back into
 * `current` so hot keys survive across rotations. Total retained entries are
 * therefore bounded by roughly `2 * maxEntries`.
 *
 * Stats (hits, misses, promotions, generation rotations, clears, sizes) are
 * tracked outside production for debug measurement.
 */

export interface BoundedGenerationalCacheStats {
	/** Human-readable name used to identify the cache in stats output. */
	name: string;
	/** Maximum entries kept in the current generation. */
	maxEntries: number;
	/** Entries currently held in the current generation. */
	currentSize: number;
	/** Entries retained in the previous generation. */
	previousSize: number;
	/** Cumulative successful reads since creation. */
	hits: number;
	/** Cumulative failed reads since creation. */
	misses: number;
	/** Cumulative promotions from the previous to the current generation. */
	promotions: number;
	/** Cumulative generation rotations (current became previous). */
	generations: number;
	/** Cumulative explicit `clear()` calls. */
	clears: number;
}

export interface BoundedGenerationalCache<K, V> {
	get(key: K): V | undefined;
	set(key: K, value: V): void;
	clear(): void;
	getStats(): BoundedGenerationalCacheStats;
}

export function createBoundedGenerationalCache<K, V>(
	name: string,
	maxEntries: number,
): BoundedGenerationalCache<K, V> {
	if (maxEntries <= 0) {
		throw new Error(
			`BoundedGenerationalCache maxEntries must be positive (got ${maxEntries})`,
		);
	}

	if (process.env.NODE_ENV === "production") {
		return createUnmeasuredBoundedGenerationalCache(name, maxEntries);
	}

	return createMeasuredBoundedGenerationalCache(name, maxEntries);
}

function createUnmeasuredBoundedGenerationalCache<K, V>(
	name: string,
	maxEntries: number,
): BoundedGenerationalCache<K, V> {
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
			if (fromPrevious !== undefined) {
				previous.delete(key);
				current.set(key, fromPrevious);
				if (current.size >= maxEntries) {
					rotate();
				}
				return fromPrevious;
			}

			return undefined;
		},

		set(key: K, value: V): void {
			current.set(key, value);
			if (current.size >= maxEntries) {
				rotate();
			}
		},

		clear(): void {
			current = new Map<K, V>();
			previous = new Map<K, V>();
		},

		getStats(): BoundedGenerationalCacheStats {
			return {
				name,
				maxEntries,
				currentSize: current.size,
				previousSize: previous.size,
				hits: 0,
				misses: 0,
				promotions: 0,
				generations: 0,
				clears: 0,
			};
		},
	};
}

function createMeasuredBoundedGenerationalCache<K, V>(
	name: string,
	maxEntries: number,
): BoundedGenerationalCache<K, V> {
	let current = new Map<K, V>();
	let previous = new Map<K, V>();
	let hits = 0;
	let misses = 0;
	let promotions = 0;
	let generations = 0;
	let clears = 0;

	function rotate(): void {
		previous = current;
		current = new Map<K, V>();
		generations++;
	}

	return {
		get(key: K): V | undefined {
			const fromCurrent = current.get(key);
			if (fromCurrent !== undefined) {
				hits++;
				return fromCurrent;
			}

			const fromPrevious = previous.get(key);
			if (fromPrevious !== undefined) {
				hits++;
				previous.delete(key);
				current.set(key, fromPrevious);
				promotions++;
				if (current.size >= maxEntries) {
					rotate();
				}
				return fromPrevious;
			}

			misses++;
			return undefined;
		},

		set(key: K, value: V): void {
			// Update in place if already in current to avoid double counting
			// size and to refresh the value.
			current.set(key, value);
			if (current.size >= maxEntries) {
				rotate();
			}
		},

		clear(): void {
			current = new Map<K, V>();
			previous = new Map<K, V>();
			clears++;
		},

		getStats(): BoundedGenerationalCacheStats {
			return {
				name,
				maxEntries,
				currentSize: current.size,
				previousSize: previous.size,
				hits,
				misses,
				promotions,
				generations,
				clears,
			};
		},
	};
}
