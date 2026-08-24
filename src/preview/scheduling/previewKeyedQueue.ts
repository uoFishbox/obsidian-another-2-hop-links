/**
 * Small keyed FIFO used by preview schedulers.
 *
 * Re-enqueueing a key supersedes its older queue entry. The scheduler remains
 * responsible for settling the replaced task because activation and DOM
 * commits expose different result types.
 */
export interface PreviewKeyedQueue<T> {
	readonly size: number;
	readonly queuedEntryCount: number;
	clear(): void;
	compact(): void;
	delete(key: string, expected?: T): boolean;
	dequeue(): T | undefined;
	enqueue(key: string, value: T): T | undefined;
	get(key: string): T | undefined;
	values(): IterableIterator<T>;
}

/** Creates a coalescing keyed FIFO without owning task lifecycle semantics. */
export function createPreviewKeyedQueue<T>(): PreviewKeyedQueue<T> {
	const pendingByKey = new Map<string, T>();
	let entries: Array<{ readonly key: string; readonly value: T }> = [];
	let head = 0;

	function enqueue(key: string, value: T): T | undefined {
		const previous = pendingByKey.get(key);
		pendingByKey.set(key, value);
		entries.push({ key, value });
		return previous;
	}

	function get(key: string): T | undefined {
		return pendingByKey.get(key);
	}

	function deleteEntry(key: string, expected?: T): boolean {
		if (expected !== undefined && pendingByKey.get(key) !== expected) return false;
		return pendingByKey.delete(key);
	}

	function dequeue(): T | undefined {
		if (head >= entries.length) return undefined;
		const entry = entries[head];
		head += 1;
		return entry.value;
	}

	function compact(): void {
		if (head < 64 && entries.length <= pendingByKey.size * 2 + 16) return;
		entries = entries
			.slice(head)
			.filter((entry) => pendingByKey.get(entry.key) === entry.value);
		head = 0;
	}

	function clear(): void {
		pendingByKey.clear();
		entries = [];
		head = 0;
	}

	return {
		get size() {
			return pendingByKey.size;
		},
		get queuedEntryCount() {
			return Math.max(0, entries.length - head);
		},
		clear,
		compact,
		delete: deleteEntry,
		dequeue,
		enqueue,
		get,
		values: () => pendingByKey.values(),
	};
}
