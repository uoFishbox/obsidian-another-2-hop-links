import type { TwoHopLinkBranch, TwoHopIndexedLink } from "types/domain";

export interface MergedBranchEntry {
	hop1: TwoHopIndexedLink;
	hop2: TwoHopIndexedLink[];
	hop2UsageKeys: string[];
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
			if (tryMarkUsed(entry.hop2UsageKeys[index])) {
				filteredHop2 ??= new Array(maxLen);
				filteredHop2[writeIdx] = entry.hop2[index];
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
