import type { TaggedNote, IndexedLink } from "indexing/model";
import type { TwoHopLinkBranch } from "two-hop/model";
import type { DedupState } from "two-hop/display/deduplication/usageTracker";
import * as keyGenerator from "cards/identity/usageKeys";
import { createUsageTracker } from "./usageTracker";

interface CanonicalBranchEntry {
	hop1: IndexedLink;
	hop2Groups: TwoHopLinkBranch["hop2"][];
}

export interface DeduplicatedLinkData {
	readonly branches: readonly TwoHopLinkBranch[];
	readonly backlinks: readonly IndexedLink[];
	readonly twoHopBranches: readonly TwoHopLinkBranch[];
}

export interface DeduplicatedLinkResult {
	readonly data: DeduplicatedLinkData;
	readonly state: DedupState;
}

/**
 * Deduplicates link sections in branch, backlink, then hop2 precedence order.
 * Groups hop2 arrays by first branch appearance before consuming their keys.
 */
export function deduplicateLinks(
	state: DedupState,
	branches: readonly TwoHopLinkBranch[],
	backlinks: readonly IndexedLink[],
): DeduplicatedLinkResult {
	const tracker = createUsageTracker(state);
	const canonicalBranches = new Map<string, CanonicalBranchEntry>();
	const seenPrimaryDisplayKeys = new Set<string>();
	let uniqueBranches: TwoHopLinkBranch[] | undefined;

	for (let index = 0; index < branches.length; index += 1) {
		const branch = branches[index];
		const keys = keyGenerator.getBranchKeys(branch);
		mergeCanonicalBranch(canonicalBranches, branch, keys.displayKey);

		if (
			seenPrimaryDisplayKeys.has(keys.displayKey) ||
			!tracker.tryMarkUsed(keys.usageKey)
		) {
			uniqueBranches ??= branches.slice(0, index);
			continue;
		}

		seenPrimaryDisplayKeys.add(keys.displayKey);
		uniqueBranches?.push(branch);
	}

	let uniqueBacklinks: IndexedLink[] | undefined;
	for (let index = 0; index < backlinks.length; index += 1) {
		const backlink = backlinks[index];
		if (!tracker.tryMarkUsed(keyGenerator.getLinkUsageKey(backlink))) {
			uniqueBacklinks ??= backlinks.slice(0, index);
			continue;
		}

		uniqueBacklinks?.push(backlink);
	}

	return {
		data: {
			branches: uniqueBranches ?? branches,
			backlinks: uniqueBacklinks ?? backlinks,
			twoHopBranches: consumeCanonicalHop2(
				canonicalBranches,
				tracker.tryMarkUsed,
			),
		},
		state: tracker.getState(),
	};
}

/** Filters tagged notes against prior sections and each other without copying or changing state. */
export function deduplicateTaggedNotes(
	state: DedupState,
	taggedNotes: readonly TaggedNote[],
): readonly TaggedNote[] {
	if (taggedNotes.length === 0) {
		return taggedNotes;
	}

	const seenTagKeys = new Set<string>();
	let filteredItems: TaggedNote[] | undefined;

	for (let index = 0; index < taggedNotes.length; index += 1) {
		const taggedNote = taggedNotes[index];
		const usageKey =
			taggedNote.usageKey ?? keyGenerator.getTaggedNoteKey(taggedNote);
		if (state.usedKeys.has(usageKey) || seenTagKeys.has(usageKey)) {
			filteredItems ??= taggedNotes.slice(0, index);
			continue;
		}

		seenTagKeys.add(usageKey);
		filteredItems?.push(taggedNote);
	}

	return filteredItems ?? taggedNotes;
}

function mergeCanonicalBranch(
	canonicalBranches: Map<string, CanonicalBranchEntry>,
	branch: TwoHopLinkBranch,
	displayKey: string,
): void {
	let entry = canonicalBranches.get(displayKey);
	if (!entry) {
		entry = {
			hop1: branch.hop1,
			hop2Groups: [],
		};
		canonicalBranches.set(displayKey, entry);
	}

	if (branch.hop2.length > 0) entry.hop2Groups.push(branch.hop2);
}

function consumeCanonicalHop2(
	canonicalBranches: ReadonlyMap<string, CanonicalBranchEntry>,
	tryMarkUsed: (usageKey: string) => boolean,
): TwoHopLinkBranch[] {
	const result: TwoHopLinkBranch[] = [];

	for (const entry of canonicalBranches.values()) {
		const filteredHop2: IndexedLink[] = [];
		// Consume a whole canonical branch before the next, even for interleaved duplicates.
		for (const hop2 of entry.hop2Groups) {
			for (const link of hop2) {
				if (!tryMarkUsed(keyGenerator.getLinkUsageKey(link))) continue;
				filteredHop2.push(link);
			}
		}

		if (filteredHop2.length === 0) continue;
		result.push({ hop1: entry.hop1, hop2: filteredHop2 });
	}

	return result;
}
