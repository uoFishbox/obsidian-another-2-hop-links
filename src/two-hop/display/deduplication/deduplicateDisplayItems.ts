import type { TaggedNote, IndexedLink } from "indexing/model";
import type { TwoHopLinkBranch } from "two-hop/model";
import type {
	DedupResult,
	DedupState,
} from "two-hop/display/deduplication/usageTracker";
import * as keyGenerator from "cards/identity/usageKeys";
import { createUsageTracker } from "./usageTracker";

interface CanonicalBranchEntry {
	hop1: IndexedLink;
	hop2: IndexedLink[];
	hop2UsageKeys: string[];
	seenHop2UsageKeys: Set<string>;
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
 * Branch keys and merged hop2 entries are collected in one branch walk.
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

/** Deduplicates tagged notes after all previously consumed sections. */
export function deduplicateTaggedNotes(
	state: DedupState,
	taggedNotes: readonly TaggedNote[],
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

function mergeCanonicalBranch(
	canonicalBranches: Map<string, CanonicalBranchEntry>,
	branch: TwoHopLinkBranch,
	displayKey: string,
): void {
	let entry = canonicalBranches.get(displayKey);
	if (!entry) {
		entry = {
			hop1: branch.hop1,
			hop2: [],
			hop2UsageKeys: [],
			seenHop2UsageKeys: new Set<string>(),
		};
		canonicalBranches.set(displayKey, entry);
	}

	for (const link of branch.hop2) {
		const usageKey = keyGenerator.getLinkUsageKey(link);
		if (entry.seenHop2UsageKeys.has(usageKey)) continue;
		entry.seenHop2UsageKeys.add(usageKey);
		entry.hop2.push(link);
		entry.hop2UsageKeys.push(usageKey);
	}
}

function consumeCanonicalHop2(
	canonicalBranches: ReadonlyMap<string, CanonicalBranchEntry>,
	tryMarkUsed: (usageKey: string) => boolean,
): TwoHopLinkBranch[] {
	const result: TwoHopLinkBranch[] = [];

	for (const entry of canonicalBranches.values()) {
		const filteredHop2: IndexedLink[] = [];
		for (let index = 0; index < entry.hop2.length; index += 1) {
			if (!tryMarkUsed(entry.hop2UsageKeys[index])) continue;
			filteredHop2.push(entry.hop2[index]);
		}

		if (filteredHop2.length === 0) continue;
		result.push({ hop1: entry.hop1, hop2: filteredHop2 });
	}

	return result;
}
