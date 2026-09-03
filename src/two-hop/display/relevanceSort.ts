import type { ISortService } from "cards/sorting";
import { forEachLinkReferenceUnordered } from "indexing/metadata/metadataExtractor";
import {
	resolveLinkDestination,
	toCaseInsensitiveLookupKey,
} from "indexing/link-resolution/linkResolution";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import type { MergedLinkItem } from "./displayDataPreprocessor";

/** Reads unique internal destinations, including unresolved links, from host metadata. */
export function getRelevanceLinkTargets(
	path: string,
	metadataCache: IMetadataCache,
	vault: IVault,
): ReadonlySet<string> {
	const targets = new Set<string>();
	const file = resolveFileByPath(vault, path);
	if (!file) return targets;

	forEachLinkReferenceUnordered(metadataCache.getFileCache(file), (reference) => {
		const resolution = resolveLinkDestination(metadataCache, reference, path);
		targets.add(toCaseInsensitiveLookupKey(resolution.lookupPath));
	});
	return targets;
}

/** Supplies normalized, unique destinations without reading note contents. */
export type GetRelevanceLinkTargets = (path: string) => ReadonlySet<string>;

/**
 * Orders one-hop cards by (forward, unique shared destinations, modified time).
 * Uses the complete origin link set, independently of display filtering/deduplication.
 */
export function sortOneHopByRelevance<T extends MergedLinkItem>(
	items: readonly T[],
	originPath: string | undefined,
	getLinkTargets: GetRelevanceLinkTargets,
	sortService: ISortService,
	direction: "asc" | "desc" = "desc",
): readonly T[] {
	if (items.length <= 1) return items;
	const byModifiedDate = sortService.sort(
		items,
		direction === "desc" ? "modified-date-reverse" : "modified-date",
	);
	if (!originPath) return byModifiedDate;

	const forwardTargets = getLinkTargets(originPath);
	const relatedTargets = new Set(forwardTargets);
	relatedTargets.add(toCaseInsensitiveLookupKey(originPath));
	const scores = new Map<string, { forward: number; point: number }>();
	const scored = byModifiedDate.map((item) => {
		const path = "hop1" in item ? item.hop1.path : item.sourceFile.path;
		const key = toCaseInsensitiveLookupKey(path ?? "");
		let score = scores.get(key);
		if (!score) {
			let point = 0;
			if (path) {
				for (const target of getLinkTargets(path)) {
					if (relatedTargets.has(target)) point += 1;
				}
			}
			score = { forward: Number(forwardTargets.has(key)), point };
			scores.set(key, score);
		}
		return { item, ...score };
	});

	// Stable sorting retains modified-date order when both relevance keys tie.
	const directionMultiplier = direction === "desc" ? -1 : 1;
	scored.sort(
		(a, b) => directionMultiplier * (a.forward - b.forward || a.point - b.point),
	);
	return scored.every(({ item }, index) => item === items[index])
		? items
		: scored.map(({ item }) => item);
}
