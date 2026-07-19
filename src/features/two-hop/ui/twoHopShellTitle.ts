import type { LinkUtilitiesContext } from "types/linkContext";
import type { PluginSettings } from "types/settings";
import { resolveCardTitleSnapshot } from "ui/components/items/cardRenderModel";
import type { TwoHopVirtualListItem } from "features/two-hop/ui/twoHopVirtualListModel";

export interface TwoHopShellTitleRevision {
	readonly priorityFrontmatterKeyForTitle: PluginSettings["priorityFrontmatterKeyForTitle"];
	readonly metadataVersion: number;
	readonly sourcePath: string;
	readonly linkContext: LinkUtilitiesContext;
}

/** Resolves the rich-card title without compiling preview or interaction state. */
export function resolveTwoHopShellTitle(
	item: TwoHopVirtualListItem,
	revision: TwoHopShellTitleRevision,
): string {
	return resolveCardTitleSnapshot(item.item, revision, revision.linkContext).title;
}
