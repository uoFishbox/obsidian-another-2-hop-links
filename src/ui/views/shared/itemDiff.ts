type MergePreservingUnchangedOptions<T> = {
	getKey: (item: T) => string;
	getVersion: (item: T) => number | string;
	changedKeys?: Set<string>;
};

export function mergeItemsPreservingUnchanged<T>(
	previousItems: T[],
	nextItems: T[],
	options: MergePreservingUnchangedOptions<T>,
): T[] {
	const previousByKey = new Map<string, T>();
	for (const item of previousItems) {
		previousByKey.set(options.getKey(item), item);
	}

	const mergedItems = new Array<T>(nextItems.length);
	for (let index = 0; index < nextItems.length; index += 1) {
		const item = nextItems[index];
		const key = options.getKey(item);
		const previous = previousByKey.get(key);
		if (!previous) {
			mergedItems[index] = item;
			continue;
		}
		mergedItems[index] =
			options.changedKeys?.has(key) ||
			options.getVersion(previous) !== options.getVersion(item)
				? item
				: previous;
	}
	return mergedItems;
}
