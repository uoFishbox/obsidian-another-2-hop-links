import type { TFile } from "obsidian";
import { describe, expect, test } from "vitest";
import {
	applyLoadedFileContentEntry,
	reconcileFileContentIndex,
	type SearchContentIndexEntry,
} from "features/search/fileContentSearchIndex";

const createMockFile = (path: string, mtime: number): TFile =>
	({
		path,
		stat: { mtime },
	}) as unknown as TFile;

const createEntry = (content: string, mtime: number): SearchContentIndexEntry => ({
	content,
	mtime,
});

describe("reconcileFileContentIndex", () => {
	test("keeps active cached entries when mtime is unchanged", () => {
		const file = createMockFile("notes/a.md", 100);
		const cachedEntry = createEntry("alpha", 100);
		const currentIndex = new Map<string, SearchContentIndexEntry>([
			[file.path, cachedEntry],
			["notes/inactive.md", createEntry("stale", 100)],
		]);

		const result = reconcileFileContentIndex([file], currentIndex);

		expect(result.nextIndex.get(file.path)).toBe(cachedEntry);
		expect(result.nextIndex.has("notes/inactive.md")).toBe(false);
		expect(result.filesToLoad).toEqual([]);
		expect(Array.from(result.activePaths)).toEqual([file.path]);
	});

	test("queues files for reload when mtime changed", () => {
		const file = createMockFile("notes/a.md", 200);
		const currentIndex = new Map<string, SearchContentIndexEntry>([
			[file.path, createEntry("old", 100)],
		]);

		const result = reconcileFileContentIndex([file], currentIndex);

		expect(result.nextIndex.has(file.path)).toBe(false);
		expect(result.filesToLoad).toEqual([file]);
	});

	test("queues files for reload when no cached entry exists", () => {
		const file = createMockFile("notes/new.md", 100);

		const result = reconcileFileContentIndex([file], new Map());

		expect(result.filesToLoad).toEqual([file]);
		expect(result.nextIndex.size).toBe(0);
	});

	test("iterates searchableFiles directly, last duplicate wins for filesToLoad", () => {
		const older = createMockFile("notes/a.md", 100);
		const newer = createMockFile("notes/a.md", 200);

		const result = reconcileFileContentIndex([older, newer], new Map());

		expect(result.filesToLoad).toHaveLength(2);
		expect(result.filesToLoad[0].path).toBe("notes/a.md");
		expect(result.filesToLoad[0].stat.mtime).toBe(100);
		expect(result.filesToLoad[1].path).toBe("notes/a.md");
		expect(result.filesToLoad[1].stat.mtime).toBe(200);
		expect(result.activePaths.size).toBe(1);
	});
});

describe("applyLoadedFileContentEntry", () => {
	test("sets new entry when path is missing", () => {
		const index = new Map<string, SearchContentIndexEntry>();

		applyLoadedFileContentEntry(index, "notes/a.md", createEntry("first", 100));

		expect(index.get("notes/a.md")).toEqual(createEntry("first", 100));
	});

	test("does not overwrite newer entry with older mtime", () => {
		const index = new Map<string, SearchContentIndexEntry>([
			["notes/a.md", createEntry("newest", 200)],
		]);

		applyLoadedFileContentEntry(index, "notes/a.md", createEntry("older", 100));

		expect(index.get("notes/a.md")).toEqual(createEntry("newest", 200));
	});

	test("overwrites older entry when loaded entry is newer or equal", () => {
		const index = new Map<string, SearchContentIndexEntry>([
			["notes/a.md", createEntry("old", 100)],
		]);

		applyLoadedFileContentEntry(index, "notes/a.md", createEntry("newer", 200));
		expect(index.get("notes/a.md")).toEqual(createEntry("newer", 200));

		applyLoadedFileContentEntry(
			index,
			"notes/a.md",
			createEntry("same-mtime-update", 200),
		);
		expect(index.get("notes/a.md")).toEqual(createEntry("same-mtime-update", 200));
	});
});
