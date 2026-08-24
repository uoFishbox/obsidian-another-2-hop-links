import type { TFile } from "obsidian";
import type { IndexedLink, IndexedLinkQueryResult, TaggedNote } from "indexing/model";

export interface TwoHopLinkBranch {
	readonly hop1: IndexedLink;
	readonly hop2: IndexedLinkQueryResult;
}

export interface TagGroup {
	readonly tag: string;
	readonly notes: readonly TaggedNote[];
}

export interface TwoHopLinkResult {
	readonly originFile: TFile;
	readonly branches: readonly Readonly<TwoHopLinkBranch>[];
	readonly backlinks: IndexedLinkQueryResult;
	readonly taggedNotes: readonly Readonly<TaggedNote>[];
}

export type ResolvePhase = "base" | "twohop" | "complete";

export interface ResolveProgress {
	phase: ResolvePhase;
	data: TwoHopLinkResult;
}
