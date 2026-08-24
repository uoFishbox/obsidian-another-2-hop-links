import type { IndexedLink, IndexedLinkQueryResult } from "indexing/model";

/** Link-branch shape consumed by card presentation and sorting. */
export interface CardLinkBranch {
	readonly hop1: IndexedLink;
	readonly hop2: IndexedLinkQueryResult;
}
