import type { ReadonlyIndexState } from "../indexState";
import { getLookupKeyForEdge } from "../link-index/linkIndex";

/**
 * Finds source files for update notifications without retaining a third index.
 * This event path may scan buckets; ordinary backlink queries remain O(indegree).
 */
export function collectSourcePathsForLookupKeys(
	snapshot: ReadonlyIndexState,
	lookupKeys: Iterable<string>,
): Set<string> {
	const targets = new Set(lookupKeys);
	const result = new Set<string>();
	if (targets.size === 0) return result;

	for (const [edgeKey, sources] of snapshot.incoming) {
		const lookupKey = getLookupKeyForEdge(edgeKey);
		if (!lookupKey || !targets.has(lookupKey)) continue;
		for (const sourcePath of sources.keys()) result.add(sourcePath);
	}
	return result;
}
