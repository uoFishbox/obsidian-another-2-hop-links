import { describe, expect, test } from "vitest";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { TaggedNote } from "types/domain";
import { groupNotesByTag } from "../grouping";

function createTaggedNote(path: string, commonTags: string[]): TaggedNote {
	return {
		file: createMockTFile(path),
		commonTags,
		path,
	};
}

describe("groupNotesByTag", () => {
	test("groups notes by tag and returns them in descending order of note count", () => {
		const note1 = createTaggedNote("note1.md", ["#tag1", "#tag2"]);
		const note2 = createTaggedNote("note2.md", ["#tag1"]);

		const result = groupNotesByTag([note1, note2]);

		expect(result).toEqual([
			{
				tag: "#tag1",
				notes: [note1, note2],
			},
			{
				tag: "#tag2",
				notes: [note1],
			},
		]);
	});

	test("tags with same note count are stably ordered by tag name", () => {
		const note1 = createTaggedNote("note1.md", ["#zeta"]);
		const note2 = createTaggedNote("note2.md", ["#alpha"]);
		const note3 = createTaggedNote("note3.md", ["#beta"]);

		const result = groupNotesByTag([note1, note2, note3]);

		expect(result.map((group) => group.tag)).toEqual([
			"#alpha",
			"#beta",
			"#zeta",
		]);
	});
});
