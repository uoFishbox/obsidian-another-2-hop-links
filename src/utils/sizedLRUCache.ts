export interface SizedEntry<V> {
	value: V;
	size: number;
	dispose?: () => void;
}

export interface SizedLRUCache<K, V> {
	get(key: K): V | undefined;
	set(key: K, value: V, size: number, dispose?: () => void): void;
	clear(): void;
}

export function createSizedLRUCache<K, V>(
	maxSize: number,
): SizedLRUCache<K, V> {
	const map = new Map<K, SizedEntry<V>>();
	let totalSize = 0;

	function evictOverflow(): void {
		while (totalSize > maxSize) {
			const oldestKey = map.keys().next().value;
			if (oldestKey === undefined) {
				break;
			}

			const oldest = map.get(oldestKey);
			if (oldest) {
				oldest.dispose?.();
				totalSize -= oldest.size;
			}
			map.delete(oldestKey);
		}
	}

	return {
		get(key: K): V | undefined {
			const entry = map.get(key);
			if (!entry) {
				return undefined;
			}

			map.delete(key);
			map.set(key, entry);
			return entry.value;
		},

		set(key: K, value: V, size: number, dispose?: () => void): void {
			const old = map.get(key);
			if (old) {
				old.dispose?.();
				totalSize -= old.size;
				map.delete(key);
			}

			map.set(key, { value, size, dispose });
			totalSize += size;
			evictOverflow();
		},

		clear(): void {
			for (const entry of map.values()) {
				entry.dispose?.();
			}

			map.clear();
			totalSize = 0;
		},
	};
}

export function stringBytes(value: string): number {
	return value.length * 2;
}
