import type { BacklinkBucket } from "types/domain";

export function getBacklinkCollectionCount(collection: BacklinkBucket): number {
	return collection.count;
}

export function hasResolvedBacklink(collection: BacklinkBucket): boolean {
	return collection.hasResolved;
}
