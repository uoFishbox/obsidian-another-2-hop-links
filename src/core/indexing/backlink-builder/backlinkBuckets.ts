import type { BacklinkBucket } from "types/domain";

export function hasResolvedBacklink(collection: BacklinkBucket): boolean {
	return collection.hasResolved;
}
