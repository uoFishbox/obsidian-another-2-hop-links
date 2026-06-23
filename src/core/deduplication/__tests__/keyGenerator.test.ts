import { describe, test, expect } from "vitest";
import {
	getBranchUsageKey,
	getLinkUsageKey,
	getTaggedNoteKey,
	getBranchDisplayKey,
} from "../keyGenerator";
import type { TwoHopLinkBranch, TwoHopIndexedLink, TaggedNote } from "types/domain";
import { type TFile } from "obsidian";

vi.mock("obsidian", () => ({
	normalizePath: vi.fn((path: string) => path.replace(/\\/g, "/")),
}));

describe("keyGenerator", () => {
	describe("getBranchUsageKey", () => {
		test("returns file key for resolved branches", () => {
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "[[Note]]",
					path: "Folder/Note.md",
					isUnresolved: false,
					sourceFile: { path: "source.md" } as TFile,
				},
				hop2: [],
			};

			expect(getBranchUsageKey(branch)).toBe("f:folder/note.md");
		});

		test("returns text key for unresolved branches", () => {
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "Unresolved Link",
					path: undefined,
					isUnresolved: true,
					sourceFile: { path: "source.md" } as TFile,
				},
				hop2: [],
			};

			expect(getBranchUsageKey(branch)).toBe("t:unresolved link");
		});

		test("even for unresolved branches, lookupPath takes priority if present", () => {
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "Unresolved Link",
					path: undefined,
					lookupPath: "Folder/Missing.md",
					isUnresolved: true,
					sourceFile: { path: "source.md" } as TFile,
				},
				hop2: [],
			};

			expect(getBranchUsageKey(branch)).toBe("t:folder/missing.md");
		});
	});

	describe("getLinkUsageKey", () => {
		test("uses displayText when present", () => {
			const link: TwoHopIndexedLink = {
				rawText: "[[note]]",
				path: "note.md",
				displayText: "Display Text",
				isUnresolved: false,
				sourceFile: { path: "Folder/Source.md" } as TFile,
			};

			expect(getLinkUsageKey(link)).toBe("f:folder/source.md");
		});

		test("uses rawText when displayText is absent", () => {
			const link: TwoHopIndexedLink = {
				rawText: "Raw Text",
				path: "note.md",
				displayText: undefined,
				isUnresolved: false,
				sourceFile: { path: "Folder/Source.md" } as TFile,
			};

			expect(getLinkUsageKey(link)).toBe("f:folder/source.md");
		});

		test("uses text key when file key is absent", () => {
			const link: TwoHopIndexedLink = {
				rawText: "Raw Text",
				path: undefined,
				displayText: "Display Text",
				isUnresolved: true,
				sourceFile: { path: undefined } as any,
			};

			expect(getLinkUsageKey(link)).toBe("t:display text");
		});
	});

	describe("getTaggedNoteKey", () => {
		test("returns normalized path for tagged notes", () => {
			const taggedNote: TaggedNote = {
				file: { path: "Folder/Note.md" } as TFile,
				commonTags: ["#tag1", "#tag2"],
				path: "Folder/Note.md",
			};

			expect(getTaggedNoteKey(taggedNote)).toBe("f:folder/note.md");
		});

		test("normalizes paths with uppercase and backslashes", () => {
			const taggedNote: TaggedNote = {
				file: { path: "Folder\\SubFolder\\Note.MD" } as TFile,
				commonTags: ["#tag"],
				path: "Folder\\SubFolder\\Note.MD",
			};

			expect(getTaggedNoteKey(taggedNote)).toBe("f:folder/subfolder/note.md");
		});
	});

	describe("edge case: identity tests", () => {
		test("different branches pointing to the same file generate the same usageKey", () => {
			const branch1: TwoHopLinkBranch = {
				hop1: {
					rawText: "[[Note]]",
					path: "Folder/Note.md",
					isUnresolved: false,
					sourceFile: { path: "source.md" } as TFile,
				},
				hop2: [],
			};

			const branch2: TwoHopLinkBranch = {
				hop1: {
					rawText: "[[note]]",
					path: "folder\\note.md",
					isUnresolved: false,
					sourceFile: { path: "source.md" } as TFile,
				},
				hop2: [],
			};

			expect(getBranchUsageKey(branch1)).toBe(getBranchUsageKey(branch2));
		});

		test("links from the same source file generate the same usageKey", () => {
			const link1: TwoHopIndexedLink = {
				rawText: "[[target]]",
				path: "target.md",
				displayText: "Display",
				isUnresolved: false,
				sourceFile: { path: "Folder/Source.md" } as TFile,
			};

			const link2: TwoHopIndexedLink = {
				rawText: "[[target]]",
				path: "target.md",
				displayText: "Different Display",
				isUnresolved: false,
				sourceFile: { path: "folder\\source.md" } as TFile,
			};

			expect(getLinkUsageKey(link1)).toBe(getLinkUsageKey(link2));
		});

		test("getBranchDisplayKey returns normalized path when needed", () => {
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "[[Note]]",
					path: "Folder/Note.md",
					isUnresolved: false,
					sourceFile: { path: "source.md" } as TFile,
				},
				hop2: [],
			};

			expect(getBranchDisplayKey(branch)).toBe("folder/note.md");
		});

		test("getBranchDisplayKey uses lookupPath for unresolved branches", () => {
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "[[Missing]]",
					path: undefined,
					lookupPath: "Folder/Missing.md",
					isUnresolved: true,
					sourceFile: { path: "source.md" } as TFile,
				},
				hop2: [],
			};

			expect(getBranchDisplayKey(branch)).toBe("folder/missing.md");
		});
	});
});
