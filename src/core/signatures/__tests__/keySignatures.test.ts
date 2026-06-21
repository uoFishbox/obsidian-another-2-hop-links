import { describe, expect, test, vi } from "vitest";
import type { TFile } from "obsidian";
import type { TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import {
	createBacklinkIdentitySignature,
	createBranchIdentitySignature,
	createBranchUsageSignature,
	createIndexedLinkIdentitySignature,
	createIndexedLinkUsageSignature,
	createLengthPrefixedSignature,
	createTaggedNoteUsageSignature,
	normalizePathSignature,
	serializePositionSignature,
} from "../keySignatures";

vi.mock("obsidian", () => ({
	normalizePath: vi.fn((path: string) => path.replace(/\\/g, "/")),
}));

function createFile(path: string): TFile {
	return { path } as TFile;
}

describe("keySignatures", () => {
	test("normalizes path case and slashes", () => {
		expect(normalizePathSignature("Folder\\SubFolder\\Note.MD")).toBe(
			"folder/subfolder/note.md",
		);
	});

	test("creates collision-resistant length-prefixed signatures", () => {
		const keyA = createLengthPrefixedSignature(["a-b", "c", ""]);
		const keyB = createLengthPrefixedSignature(["a", "b-c", ""]);

		expect(keyA).not.toBe(keyB);
		expect(keyA).toBe("3:a-b|1:c|0:");
	});

	test("creates usage signatures without UI identity fields", () => {
		const sourceFile = createFile("Source.md");
		const branch: TwoHopLinkBranch = {
			hop1: {
				sourceFile,
				rawText: "[[Note]]",
				path: "Folder\\Note.md",
				isUnresolved: false,
				position: {
					start: { line: 1, col: 2, offset: 3 },
					end: { line: 1, col: 10, offset: 11 },
				},
			},
			hop2: [],
		};
		const movedBranch: TwoHopLinkBranch = {
			...branch,
			hop1: {
				...branch.hop1,
				position: {
					start: { line: 5, col: 2, offset: 30 },
					end: { line: 5, col: 10, offset: 38 },
				},
			},
		};

		expect(createBranchUsageSignature(branch)).toEqual({
			kind: "file",
			value: "folder/note.md",
		});
		expect(createBranchUsageSignature(movedBranch)).toEqual(
			createBranchUsageSignature(branch),
		);
		expect(createBranchIdentitySignature(movedBranch)).not.toBe(
			createBranchIdentitySignature(branch),
		);
	});

	test("creates text usage signature for unresolved branches", () => {
		const branch: TwoHopLinkBranch = {
			hop1: {
				sourceFile: createFile("source.md"),
				rawText: " Missing Note ",
				isUnresolved: true,
				path: undefined,
			},
			hop2: [],
		};

		expect(createBranchUsageSignature(branch)).toEqual({
			kind: "text",
			value: "missing note",
		});
	});

	test("creates link usage and identity signatures at different granularities", () => {
		const link: TwoHopIndexedLink = {
			sourceFile: createFile("Folder\\Source.md"),
			rawText: "[[Target]]",
			path: "Target.md",
			displayText: "Target",
			isUnresolved: false,
			backlinkCount: 2,
		};
		const renamedDisplay: TwoHopIndexedLink = {
			...link,
			displayText: "Different",
		};

		expect(createIndexedLinkUsageSignature(link)).toEqual({
			kind: "file",
			value: "folder/source.md",
		});
		expect(createIndexedLinkUsageSignature(renamedDisplay)).toEqual(
			createIndexedLinkUsageSignature(link),
		);
		expect(createBacklinkIdentitySignature(renamedDisplay)).not.toBe(
			createBacklinkIdentitySignature(link),
		);
	});

	test("creates stable backlink identity signatures with metadata suffix fields", () => {
		const link: TwoHopIndexedLink = {
			sourceFile: createFile("Source.md"),
			rawText: "Raw",
			path: "Path.md",
			lookupPath: "lookup",
			key: "frontmatter",
			isUnresolved: true,
		};

		expect(createBacklinkIdentitySignature(link, "branch:2")).toBe(
			"9:Source.md|3:Raw|41:Path.md\u001flookup\u001f\u001ffrontmatter\u001f-1\u001f1\u001fbranch:2",
		);
	});

	test("includes position in indexed link identity signatures", () => {
		const link: TwoHopIndexedLink = {
			sourceFile: createFile("source.md"),
			rawText: "[[Target]]",
			path: "Target.md",
			isUnresolved: false,
			position: {
				start: { line: 1, col: 0, offset: 10 },
				end: { line: 1, col: 10, offset: 20 },
			},
		};
		const movedLink: TwoHopIndexedLink = {
			...link,
			position: {
				start: { line: 2, col: 0, offset: 30 },
				end: { line: 2, col: 10, offset: 40 },
			},
		};

		expect(createIndexedLinkIdentitySignature(movedLink)).not.toBe(
			createIndexedLinkIdentitySignature(link),
		);
	});

	test("serializes position numbers in base36", () => {
		expect(
			serializePositionSignature({
				start: { line: 10, col: 81, offset: 226 },
				end: { line: 10, col: 101, offset: 246 },
			}),
		).toBe("a:29:6a:a:2t:6u");
	});

	test("creates tagged note usage signatures from normalized paths", () => {
		expect(createTaggedNoteUsageSignature("Folder\\Note.MD")).toEqual({
			kind: "file",
			value: "folder/note.md",
		});
	});
});
