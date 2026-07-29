import type {
	TaggedNote,
	TwoHopIndexedLink,
	TwoHopLinkBranch,
	TwoHopLinkResult,
} from "types/domain";

/**
 * Freezes a resolver-owned result graph and returns it as one immutable snapshot.
 *
 * Obsidian values referenced by the graph (`TFile` and `Pos`) remain shared because
 * they are owned outside the resolver.
 */
export function freezeTwoHopLinkResult(result: TwoHopLinkResult): TwoHopLinkResult {
	for (const branch of result.branches) {
		freezeIndexedLink(branch.hop1);
		freezeIndexedLinks(branch.hop2);
		Object.freeze(branch);
	}
	Object.freeze(result.branches);
	freezeIndexedLinks(result.backlinks);

	for (const note of result.taggedNotes) {
		Object.freeze(note.commonTags);
		Object.freeze(note);
	}
	Object.freeze(result.taggedNotes);

	if (result.displayVersions) {
		Object.freeze(result.displayVersions);
	}
	return Object.freeze(result);
}

/**
 * Copies tag-index values at the resolver boundary before they are frozen.
 */
export function createImmutableTaggedNotes(
	taggedNotes: readonly TaggedNote[],
): readonly Readonly<TaggedNote>[] {
	const snapshot = new Array<TaggedNote>(taggedNotes.length);
	for (let index = 0; index < taggedNotes.length; index += 1) {
		const note = taggedNotes[index];
		snapshot[index] = {
			...note,
			commonTags: note.commonTags.slice(),
		};
	}
	return snapshot;
}

function freezeIndexedLinks(links: readonly Readonly<TwoHopIndexedLink>[]): void {
	for (const link of links) {
		freezeIndexedLink(link);
	}
	Object.freeze(links);
}

function freezeIndexedLink(link: Readonly<TwoHopIndexedLink>): void {
	Object.freeze(link);
}
