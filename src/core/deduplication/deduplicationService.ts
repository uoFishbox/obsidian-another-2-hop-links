import type { TwoHopLinkBranch, TwoHopIndexedLink } from "types/domain";
import type { TaggedNote } from "types/domain";
import type { IDeduplicationService } from "types";
import * as keyGenerator from "./keyGenerator";
import {
	type Hop2Entry,
	type MergedBranchEntry,
	filterMergedBranchHop2,
} from "./branchMerge";
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
			mergeBranchIntoMap(
				branchMap,
				branch,
				keyGenerator.getBranchDisplayKey(branch),
			);
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
			existing.hop2Keys = appendUniqueHop2(
				existing.hop2,
				existing.hop2Keys,
				branch.hop2,
			);
			return;
		}

		const hop2: Hop2Entry[] = [];
		const hop2Keys = appendUniqueHop2(hop2, undefined, branch.hop2);
		branchMap.set(displayKey, {
			hop1: branch.hop1,
			hop2,
			hop2Keys,
		});
	}

	function appendUniqueHop2(
		entries: Hop2Entry[],
		usageKeys: Set<string> | undefined,
		links: TwoHopIndexedLink[],
	): Set<string> | undefined {
		if (links.length === 0) return usageKeys;

		const nextUsageKeys = usageKeys ?? new Set<string>();
		for (const link of links) {
			const usageKey = keyGenerator.getLinkUsageKey(link);
			if (nextUsageKeys.has(usageKey)) continue;
			nextUsageKeys.add(usageKey);
			entries.push({ link, usageKey });
		}

		return nextUsageKeys;
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
			const displayKey = keyGenerator.getBranchDisplayKey(branch);
			if (seenDisplayKeys.has(displayKey)) {
				filteredItems ??= branches.slice(0, index);
				continue;
			}

			const usageKey = keyGenerator.getBranchUsageKey(branch);
			if (!tracker.tryMarkUsed(usageKey)) {
				filteredItems ??= branches.slice(0, index);
				continue;
			}

			seenDisplayKeys.add(displayKey);
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
				taggedNote.usageKey ??
				keyGenerator.getTaggedNoteKey(taggedNote);
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
