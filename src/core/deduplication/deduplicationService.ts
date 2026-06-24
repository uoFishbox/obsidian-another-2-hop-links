import type { TwoHopLinkBranch, TwoHopIndexedLink } from "types/domain";
import type { TaggedNote } from "types/domain";
import type { IDeduplicationService } from "types";
import * as keyGenerator from "./keyGenerator";
import { type MergedBranchEntry, filterMergedBranchHop2 } from "./branchMerge";
import { createUsageTracker } from "./usageTracker";
import type { DedupResult, DedupState } from "types/deduplication";

/**
 * Creates stateless deduplication operations. Each operation returns its
 * consumption state explicitly so callers control cross-domain precedence.
 */
export function createDeduplicationService(): IDeduplicationService {
	function createBranchMap(
		branches: TwoHopLinkBranch[],
	): Map<string, MergedBranchEntry> {
		const branchMap = new Map<string, MergedBranchEntry>();
		for (let index = 0; index < branches.length; index += 1) {
			const branch = branches[index];
			const keys = keyGenerator.getBranchKeys(branch);
			mergeBranchIntoMap(branchMap, branch, keys.displayKey);
		}
		return branchMap;
	}

	function mergeBranchIntoMap(
		branchMap: Map<string, MergedBranchEntry>,
		branch: TwoHopLinkBranch,
		displayKey: string,
	): void {
		const existing = branchMap.get(displayKey);
		if (existing) {
			appendUniqueHop2(existing.hop2, existing.hop2UsageKeys, branch.hop2);
			return;
		}

		const hop2: TwoHopIndexedLink[] = [];
		const hop2UsageKeys: string[] = [];
		appendUniqueHop2(hop2, hop2UsageKeys, branch.hop2);
		branchMap.set(displayKey, {
			hop1: branch.hop1,
			hop2,
			hop2UsageKeys,
		});
	}

	function appendUniqueHop2(
		entries: TwoHopIndexedLink[],
		usageKeys: string[],
		links: TwoHopIndexedLink[],
	): void {
		if (links.length === 0) return;

		const seen = new Set(usageKeys);
		for (const link of links) {
			const usageKey = keyGenerator.getLinkUsageKey(link);
			if (seen.has(usageKey)) continue;
			seen.add(usageKey);
			entries.push(link);
			usageKeys.push(usageKey);
		}
	}

	function collectUniqueBranches(
		state: DedupState,
		branches: TwoHopLinkBranch[],
	): DedupResult<TwoHopLinkBranch> {
		if (branches.length === 0) {
			return { state, items: branches };
		}

		const tracker = createUsageTracker(state);
		const seenDisplayKeys = new Set<string>();
		let filteredItems: TwoHopLinkBranch[] | undefined;

		for (let index = 0; index < branches.length; index += 1) {
			const branch = branches[index];
			const keys = keyGenerator.getBranchKeys(branch);
			if (seenDisplayKeys.has(keys.displayKey)) {
				filteredItems ??= branches.slice(0, index);
				continue;
			}

			if (!tracker.tryMarkUsed(keys.usageKey)) {
				filteredItems ??= branches.slice(0, index);
				continue;
			}

			seenDisplayKeys.add(keys.displayKey);
			filteredItems?.push(branch);
		}

		return {
			state: tracker.getState(),
			items: filteredItems ?? branches,
		};
	}

	function collectUniqueBacklinks(
		state: DedupState,
		backlinks: TwoHopIndexedLink[],
	): DedupResult<TwoHopIndexedLink> {
		if (backlinks.length === 0) {
			return { state, items: backlinks };
		}

		const tracker = createUsageTracker(state);
		let filteredItems: TwoHopIndexedLink[] | undefined;

		for (let index = 0; index < backlinks.length; index += 1) {
			const backlink = backlinks[index];
			const usageKey = keyGenerator.getLinkUsageKey(backlink);
			if (!tracker.tryMarkUsed(usageKey)) {
				filteredItems ??= backlinks.slice(0, index);
				continue;
			}

			filteredItems?.push(backlink);
		}

		return {
			state: tracker.getState(),
			items: filteredItems ?? backlinks,
		};
	}

	function buildFilteredTwoHopBranches(
		state: DedupState,
		branches: TwoHopLinkBranch[],
	): DedupResult<TwoHopLinkBranch> {
		if (branches.length === 0) {
			return { state, items: branches };
		}

		const tracker = createUsageTracker(state);
		const items = filterMergedBranchHop2(
			createBranchMap(branches),
			tracker.tryMarkUsed,
		);
		return { state: tracker.getState(), items };
	}

	function collectUniqueTaggedNotes(
		state: DedupState,
		taggedNotes: TaggedNote[],
	): DedupResult<TaggedNote> {
		if (taggedNotes.length === 0) {
			return { state, items: taggedNotes };
		}

		const tracker = createUsageTracker(state);
		let filteredItems: TaggedNote[] | undefined;

		for (let index = 0; index < taggedNotes.length; index += 1) {
			const taggedNote = taggedNotes[index];
			const usageKey =
				taggedNote.usageKey ?? keyGenerator.getTaggedNoteKey(taggedNote);
			if (!tracker.tryMarkUsed(usageKey)) {
				filteredItems ??= taggedNotes.slice(0, index);
				continue;
			}

			filteredItems?.push(taggedNote);
		}

		return {
			state: tracker.getState(),
			items: filteredItems ?? taggedNotes,
		};
	}

	return {
		collectUniqueBranches,
		collectUniqueBacklinks,
		buildFilteredTwoHopBranches,
		collectUniqueTaggedNotes,
	};
}
