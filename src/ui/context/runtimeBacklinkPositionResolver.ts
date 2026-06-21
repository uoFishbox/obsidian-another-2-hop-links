import type { Pos } from "obsidian";

import { buildRuntimeOrderedBacklinkRefs } from "core/indexing/backlink-builder/backlinkReferenceSequence";
import type {
	CachedMetadataWithLinkReferences,
	TwoHopIndexedLink,
} from "types";

export function resolveRuntimeBacklinkPosition(
	cache: CachedMetadataWithLinkReferences | null,
	link: TwoHopIndexedLink,
): { position?: Pos; key?: string } {
	const orderedReferences = buildRuntimeOrderedBacklinkRefs(cache);

	const exact = orderedReferences.find((ref) => {
		return (
			ref.rawText === link.rawText &&
			ref.displayText === link.displayText &&
			ref.key === link.key
		);
	});
	const fallback =
		exact ?? orderedReferences.find((ref) => ref.rawText === link.rawText);

	if (!fallback) {
		return {};
	}

	return {
		position: fallback.position,
		key: fallback.key ?? link.key,
	};
}

export function hydrateRuntimeBacklinkLink(
	cache: CachedMetadataWithLinkReferences | null,
	link: TwoHopIndexedLink,
): TwoHopIndexedLink {
	const hydrated = resolveRuntimeBacklinkPosition(cache, link);
	if (!hydrated.position && hydrated.key === link.key) {
		return link;
	}

	return {
		...link,
		position: hydrated.position ?? link.position,
		key: hydrated.key ?? link.key,
	};
}
