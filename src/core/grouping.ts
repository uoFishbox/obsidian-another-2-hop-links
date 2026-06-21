import type { TaggedNote, TagGroup } from "types/domain";

/**
 * タグ付きノートをタグごとにグループ化
 *
 * @param taggedNotes - グループ化するタグ付きノートの配列
 * @returns タググループの配列(ノート数の降順でソート済み)
 */
export function groupNotesByTag(taggedNotes: TaggedNote[]): TagGroup[] {
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

	const groups: TagGroup[] = [];
	tagMap.forEach((notes, tag) => {
		groups.push({ tag, notes });
	});

	groups.sort((a, b) => {
		const noteCountDiff = b.notes.length - a.notes.length;
		return noteCountDiff !== 0 ? noteCountDiff : a.tag.localeCompare(b.tag);
	});

	return groups;
}
