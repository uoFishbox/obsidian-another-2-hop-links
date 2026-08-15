import type { BacklinksMap } from "types/domain";
import type { SourceSummary, TagIndex } from "../types/IndexTypes";

/**
 * backlink ビルド処理が生成する成果物の型。
 *
 * `backlinkIndexer.ts` と `backlinkBuildPhaseTwo.ts` の両方から参照されるため、
 * 両ファイル間の循環依存を断つために本ファイルへ切り出している。
 */
export interface BacklinksBuildArtifacts {
	detailedMap: BacklinksMap;
	sourceSummaries: Map<string, SourceSummary>;
	linkLookupToSources: Map<string, Set<string>>;
	lookupKeyToLookupPaths: Map<string, Set<string>>;
	lookupPathResolvedSourceCount: Map<string, number>;
	tagIndex: TagIndex;
}
