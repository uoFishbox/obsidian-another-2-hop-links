import type { IndexSnapshot } from "../types/IndexTypes";

export function hasDirectResolvedLookupKey(
	snapshot: IndexSnapshot,
	lookupKey: string,
): boolean {
	const lookupPaths = snapshot.lookupKeyToLookupPaths.get(lookupKey);
	if (!lookupPaths) {
		return false;
	}

	for (const lookupPath of lookupPaths) {
		if (snapshot.lookupPathResolvedSourceCount.has(lookupPath)) {
			return true;
		}
	}
	return false;
}

export function collectSourcePathsForLookupKeys(
	snapshot: IndexSnapshot,
	lookupKeys: Iterable<string>,
): Set<string> {
	const result = new Set<string>();

	for (const lookupKey of lookupKeys) {
		const lookupPaths = snapshot.lookupKeyToLookupPaths.get(lookupKey);
		if (!lookupPaths) {
			continue;
		}

		for (const lookupPath of lookupPaths) {
			const sourceMap = snapshot.backlinksMap.get(lookupPath);
			if (!sourceMap) {
				continue;
			}
			for (const sourcePath of sourceMap.keys()) {
				result.add(sourcePath);
			}
		}
	}

	return result;
}
