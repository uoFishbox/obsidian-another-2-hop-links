import { describe, expect, test, vi } from "vitest";
import type { Pos, TFile } from "obsidian";
import type { IndexedLink } from "indexing/model";
import type { CardLinkBranch } from "cards/model";
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

	test("creates collision-resistant signatures that stay stable for equal input", () => {
		// Ambiguous part boundaries must not collapse onto the same signature.
		const hyphenSplit = createLengthPrefixedSignature(["a-b", "c", ""]);
		const hyphenShifted = createLengthPrefixedSignature(["a", "b-c", ""]);
		const separatorInsidePart = createLengthPrefixedSignature(["a|b", "c"]);
		const separatorAsBoundary = createLengthPrefixedSignature(["a", "b|c"]);

		expect(hyphenSplit).not.toBe(hyphenShifted);
		expect(separatorInsidePart).not.toBe(separatorAsBoundary);

		// Repeating the same input yields the same signature.
		expect(createLengthPrefixedSignature(["a-b", "c", ""])).toBe(hyphenSplit);

		// Part count and part order are part of the identity.
		expect(createLengthPrefixedSignature(["a-b", "c"])).not.toBe(hyphenSplit);
		expect(createLengthPrefixedSignature(["c", "a-b", ""])).not.toBe(hyphenSplit);
	});

	test("creates usage signatures without UI identity fields", () => {
		const sourceFile = createFile("Source.md");
		const branch: CardLinkBranch = {
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
		const movedBranch: CardLinkBranch = {
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
		const branch: CardLinkBranch = {
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
		const link: IndexedLink = {
			sourceFile: createFile("Folder\\Source.md"),
			rawText: "[[Target]]",
			path: "Target.md",
			displayText: "Target",
			isUnresolved: false,
			backlinkCount: 2,
		};
		const renamedDisplay: IndexedLink = {
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
		expect(createBacklinkIdentitySignature(renamedDisplay)).toBe(
			createBacklinkIdentitySignature(link),
		);
	});

	test("distinguishes backlink metadata fields and suffix", () => {
		const link: IndexedLink = {
			sourceFile: createFile("Source.md"),
			rawText: "Raw",
			path: "Path.md",
			lookupPath: "lookup",
			key: "frontmatter",
			isUnresolved: true,
		};
		const signature = createBacklinkIdentitySignature(link, "branch:2");

		// Repeating the same input yields the same signature.
		expect(createBacklinkIdentitySignature(link, "branch:2")).toBe(signature);

		// Every metadata field participates in the identity, and a field cannot
		// impersonate its neighbour by moving the separator into its own value.
		const changedFields: IndexedLink[] = [
			{ ...link, path: "Other.md" },
			{ ...link, lookupPath: "other-lookup" },
			{ ...link, key: "other-key" },
			{ ...link, backlinkCount: 7 },
			{ ...link, isUnresolved: false },
			{ ...link, lookupPath: "lookup\u001fX" },
		];
		for (const changed of changedFields) {
			expect(createBacklinkIdentitySignature(changed, "branch:2")).not.toBe(
				signature,
			);
		}

		expect(createBacklinkIdentitySignature(link, "branch:3")).not.toBe(signature);
	});

	test("includes position in indexed link identity signatures", () => {
		const link: IndexedLink = {
			sourceFile: createFile("source.md"),
			rawText: "[[Target]]",
			path: "Target.md",
			isUnresolved: false,
			position: {
				start: { line: 1, col: 0, offset: 10 },
				end: { line: 1, col: 10, offset: 20 },
			},
		};
		const movedLink: IndexedLink = {
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

	test("serializes positions so every coordinate stays distinguishable", () => {
		const base: Pos = {
			start: { line: 10, col: 81, offset: 226 },
			end: { line: 10, col: 101, offset: 246 },
		};
		const baseToken = serializePositionSignature(base);

		expect(serializePositionSignature(undefined)).toBe("");
		expect(serializePositionSignature({ ...base })).toBe(baseToken);

		// The exact token format is an implementation detail; what matters is that
		// no two different coordinates serialize to the same token.
		const movedCoordinates: Pos[] = [
			{ ...base, start: { ...base.start, line: 11 } },
			{ ...base, start: { ...base.start, col: 82 } },
			{ ...base, start: { ...base.start, offset: 227 } },
			{ ...base, end: { ...base.end, line: 11 } },
			{ ...base, end: { ...base.end, col: 102 } },
			{ ...base, end: { ...base.end, offset: 247 } },
		];
		for (const position of movedCoordinates) {
			expect(serializePositionSignature(position)).not.toBe(baseToken);
		}
	});

	test("creates tagged note usage signatures from normalized paths", () => {
		expect(createTaggedNoteUsageSignature("Folder\\Note.MD")).toEqual({
			kind: "file",
			value: "folder/note.md",
		});
	});
});
