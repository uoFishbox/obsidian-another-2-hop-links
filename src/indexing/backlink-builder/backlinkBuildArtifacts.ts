import type { BacklinksMap } from "indexing/model";
import type { SourceSummary, TagIndex } from "../indexState";
import type { CompactStringSet } from "shared/collections/compactStringSet";

export interface BacklinksBuildArtifacts {
	detailedMap: BacklinksMap;
	sourceSummaries: Map<string, SourceSummary>;
	linkLookupToSources: Map<string, CompactStringSet>;
	lookupKeyToLookupPaths: Map<string, CompactStringSet>;
	lookupPathResolvedSourceCount: Map<string, number>;
	tagIndex: TagIndex;
}
