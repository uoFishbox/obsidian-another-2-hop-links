import type { TwoHopItemModel } from "features/two-hop/ui/twoHopSectionModel";

/** Materializes only the requested prefix while preserving existing item identities. */
export function materializeItemPrefix<T>(
	sources: readonly T[],
	itemLimit: number,
	previousItems: readonly TwoHopItemModel[],
	createItem: (source: T, index: number) => TwoHopItemModel,
): readonly TwoHopItemModel[] {
	const itemCount = Math.min(sources.length, Math.max(0, Math.floor(itemLimit)));
	if (previousItems.length === itemCount) return previousItems;

	const items = previousItems.slice(0, itemCount);
	for (let index = items.length; index < itemCount; index += 1) {
		const source = sources[index];
		if (source === undefined) break;
		items.push(createItem(source, index));
	}
	return items;
}
