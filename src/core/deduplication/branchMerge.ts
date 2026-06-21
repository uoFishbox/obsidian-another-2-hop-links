import type { TwoHopLinkBranch, TwoHopIndexedLink } from "types/domain";

export interface Hop2Entry {
	link: TwoHopIndexedLink;
	usageKey: string;
}

export interface MergedBranchEntry {
	hop1: TwoHopIndexedLink;
	hop2: Hop2Entry[];
	hop2Keys?: Set<string>;
}

export function filterMergedBranchHop2(
	branchMap: Map<string, MergedBranchEntry>,
	tryMarkUsed: (usageKey: string) => boolean,
): TwoHopLinkBranch[] {
	const result: TwoHopLinkBranch[] = [];

	for (const entry of branchMap.values()) {
		const maxLen = entry.hop2.length;
		if (maxLen === 0) continue;

		let filteredHop2: TwoHopIndexedLink[] | undefined;
		let writeIdx = 0;
		for (let index = 0; index < maxLen; index += 1) {
			const hop2Entry = entry.hop2[index];
			if (tryMarkUsed(hop2Entry.usageKey)) {
				filteredHop2 ??= new Array(maxLen);
				filteredHop2[writeIdx] = hop2Entry.link;
				writeIdx += 1;
			}
		}

		if (!filteredHop2) continue;

		filteredHop2.length = writeIdx;
		result.push({
			hop1: entry.hop1,
			hop2: filteredHop2,
		});
	}

	return result;
}
