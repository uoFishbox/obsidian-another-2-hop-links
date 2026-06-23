import type { BacklinkBucket } from "types/domain";

export function getBacklinkCollectionCount(collection: BacklinkBucket): number {
	return collection.count;
}

export function hasResolvedBacklink(collection: BacklinkBucket): boolean {
	return collection.hasResolved;
}

export function mergeBacklinkCollections(
	left: BacklinkBucket | undefined,
	right: BacklinkBucket,
): BacklinkBucket {
	if (!left) {
		return cloneBacklinkCollection(right);
	}

	left.count += right.count;
	left.length = left.count;
	left.hasResolved ||= right.hasResolved;
	return left;
}

export function cloneBacklinkCollection(collection: BacklinkBucket): BacklinkBucket {
	return { ...collection };
}
