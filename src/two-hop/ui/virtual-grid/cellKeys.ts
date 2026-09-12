import type { TwoHopSectionModel } from "two-hop/ui/twoHopSectionModel";

const ITEM_KEY_PREFIX = "item";
const LOAD_MORE_KEY_PREFIX = "load-more";

/**
 * Single owner of the logical-key format consumed by the shared engine and by
 * the two-hop DOM bindings. Never build these strings at call sites.
 */
export const twoHopCellKey = {
	header(section: TwoHopSectionModel): string {
		return section.header.logicalKey;
	},
	item(sectionId: string, itemKey: string): string {
		return `${ITEM_KEY_PREFIX}:${sectionId}:${itemKey}`;
	},
	loadMore(sectionId: string): string {
		return `${LOAD_MORE_KEY_PREFIX}:${sectionId}`;
	},
} as const;

export type ParsedTwoHopCellKey =
	| { readonly kind: "header" }
	| { readonly kind: "item"; readonly itemKey: string }
	| { readonly kind: "load-more" };

/**
 * Parses a logical key against one section. Item keys may contain `:`, so the
 * item payload is everything after the exact `item:<sectionId>:` prefix.
 */
export function parseTwoHopCellKey(
	section: TwoHopSectionModel,
	logicalKey: string,
): ParsedTwoHopCellKey | null {
	if (logicalKey === twoHopCellKey.header(section)) return { kind: "header" };
	if (logicalKey === twoHopCellKey.loadMore(section.id)) {
		return { kind: "load-more" };
	}
	const itemPrefix = `${ITEM_KEY_PREFIX}:${section.id}:`;
	if (!logicalKey.startsWith(itemPrefix)) return null;
	return { kind: "item", itemKey: logicalKey.slice(itemPrefix.length) };
}
