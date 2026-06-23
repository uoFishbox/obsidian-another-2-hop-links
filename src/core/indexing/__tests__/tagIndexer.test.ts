import { describe, expect, test, vi } from "vitest";
import { getNotesWithCommonTags, getNotesWithTag } from "../tag-index/tagIndexer";
import type { TagIndex } from "../types/IndexTypes";
import type { TagReference, TaggedNote } from "types/domain";
import type { IVault } from "types/obsidian";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";

function createPosition(offset: number) {
	return {
		start: { line: 0, col: offset, offset },
		end: { line: 0, col: offset + 1, offset: offset + 1 },
	};
}

function forEachParentTag(tag: string, visitor: (parentTag: string) => void): void {
	let slash = tag.indexOf("/");
	while (slash !== -1) {
		visitor(tag.slice(0, slash));
		slash = tag.indexOf("/", slash + 1);
	}

	visitor(tag);
}

function buildTagIndex(fileTags: Map<string, TagReference[]>): TagIndex {
	const tagToFilePaths = new Map<string, Set<string>>();
	const fileEntries = new Map<string, { tags: TagReference[] }>();

	for (const [path, tags] of fileTags) {
		fileEntries.set(path, { tags });
		for (const tagRef of tags) {
			forEachParentTag(tagRef.tag, (parentTag) => {
				let paths = tagToFilePaths.get(parentTag);
				if (!paths) {
					paths = new Set<string>();
					tagToFilePaths.set(parentTag, paths);
				}
				paths.add(path);
			});
		}
	}

	return {
		tagToFilePaths,
		fileEntries,
	};
}

function buildVault(files: Map<string, TFile>): IVault {
	return {
		getFiles: vi.fn(() => Array.from(files.values())),
		getMarkdownFiles: vi.fn(() => Array.from(files.values())),
		getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
		cachedRead: vi.fn(),
		getResourcePath: vi.fn(),
	} as IVault;
}

function toSortedPaths(notes: TaggedNote[]): string[] {
	return notes.map((note) => note.path).sort();
}

describe("getNotesWithTag", () => {
	const positions = {
		exact: createPosition(10),
		nested: createPosition(20),
		deep: createPosition(30),
		similar: createPosition(40),
		tag2: createPosition(50),
		tag2Child: createPosition(60),
	};

	const fileTags = new Map<string, TagReference[]>([
		["exact.md", [{ tag: "tag1", position: positions.exact }]],
		["nested.md", [{ tag: "tag1/tag2", position: positions.nested }]],
		["deep.md", [{ tag: "tag1/tag2/tag3", position: positions.deep }]],
		["similar.md", [{ tag: "tag10/tag2", position: positions.similar }]],
		["tag2.md", [{ tag: "tag2", position: positions.tag2 }]],
		["tag2-child.md", [{ tag: "tag2/sub", position: positions.tag2Child }]],
	]);

	const files = new Map<string, TFile>(
		Array.from(fileTags.keys()).map((path) => [path, createMockTFile(path)]),
	);

	const tagIndex = buildTagIndex(fileTags);
	const vault = buildVault(files);

	test("returns notes with common tags and cached usageKey", async () => {
		const localTagIndex = buildTagIndex(
			new Map<string, TagReference[]>([
				["note.md", [{ tag: "tag1", position: positions.exact }]],
			]),
		);
		const localVault = buildVault(
			new Map<string, TFile>([
				["note.md", createMockTFile("note.md")],
				["target.md", createMockTFile("target.md")],
			]),
		);
		const targetFile = createMockTFile("target.md");
		const result = getNotesWithCommonTags(localVault, localTagIndex, targetFile, [
			"tag1",
		]);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			path: "note.md",
			usageKey: "f:note.md",
		});
	});

	test("returns notes with exact and descendant tags for parent queries", async () => {
		const result = getNotesWithTag(vault, tagIndex, "tag1");
		const paths = toSortedPaths(result);

		expect(paths).toEqual(["deep.md", "exact.md", "nested.md"]);
		expect(result.every((note) => note.commonTags[0] === "tag1")).toBe(true);
		expect(
			result.every((note) => note.usageKey === `f:${note.path.toLowerCase()}`),
		).toBe(true);
		expect(result.find((note) => note.path === "nested.md")?.position).toBe(
			positions.nested,
		);
	});

	test("does not match descendant tags from different roots", async () => {
		const result = getNotesWithTag(vault, tagIndex, "tag2");
		const paths = toSortedPaths(result);

		expect(paths).toEqual(["tag2-child.md", "tag2.md"]);
		expect(paths).not.toContain("nested.md");
	});

	test("returns descendants for mid-level nested tags", async () => {
		const result = getNotesWithTag(vault, tagIndex, "tag1/tag2");
		const paths = toSortedPaths(result);

		expect(paths).toEqual(["deep.md", "nested.md"]);
		expect(paths).not.toContain("exact.md");
	});

	test("does not include tags with similar prefixes", async () => {
		const result = getNotesWithTag(vault, tagIndex, "tag1");
		const paths = toSortedPaths(result);

		expect(paths).not.toContain("similar.md");
	});

	test("normalizes hash, case, and whitespace in query tags", () => {
		const normalized = getNotesWithTag(vault, tagIndex, "tag1");
		const raw = getNotesWithTag(vault, tagIndex, "  #TAG1  ");

		expect(toSortedPaths(raw)).toEqual(toSortedPaths(normalized));
		expect(raw.every((note) => note.commonTags[0] === "tag1")).toBe(true);
		expect(
			raw.every((note) => note.usageKey === `f:${note.path.toLowerCase()}`),
		).toBe(true);
	});
});
