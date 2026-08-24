import type { TaggedNote } from "indexing/model";
import type { TagGroup } from "two-hop/model";

function compareTagGroups(a: TagGroup, b: TagGroup): number {
	const diff = b.notes.length - a.notes.length;
	return diff !== 0 ? diff : a.tag.localeCompare(b.tag);
}

export function groupNotesByTag(taggedNotes: readonly TaggedNote[]): TagGroup[] {
	if (taggedNotes.length === 0) return [];

	// タグごとにノートをマッピング
	const tagMap = new Map<string, TaggedNote[]>();

	for (const note of taggedNotes) {
		for (const tag of note.commonTags) {
			let bucket = tagMap.get(tag);
			if (!bucket) {
				bucket = [];
				tagMap.set(tag, bucket);
			}
			bucket.push(note);
		}
	}

	const groups: TagGroup[] = new Array(tagMap.size);
	let i = 0;
	for (const [tag, notes] of tagMap) {
		groups[i++] = { tag, notes };
	}

	groups.sort(compareTagGroups);

	return groups;
}
