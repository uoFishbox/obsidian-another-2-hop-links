import { describe, expect, it } from "vitest";
import {
	shouldSyncWorkerFileContents,
	diffSearchWorkerFileContents,
	diffSearchWorkerFileContentsFromVisitor,
	type WorkerFileContentSyncState,
} from "../searchWorkerContentSync";
import type { SearchContentIndexEntry } from "../fileContentSearchIndex";

function makeState(
	overrides: Partial<WorkerFileContentSyncState> = {},
): WorkerFileContentSyncState {
	return {
		sessionEnabled: true,
		matchScope: "title-and-content",
		query: "test",
		contentSyncMode: "eager",
		progressiveTick: 0,
		contentIndexIsLoading: false,
		...overrides,
	};
}

function makeEntry(
	overrides: Partial<SearchContentIndexEntry> = {},
): SearchContentIndexEntry {
	return {
		content: "body content",
		mtime: 1,
		...overrides,
	};
}

function entriesMap(
	entries: Record<string, SearchContentIndexEntry>,
): Map<string, Readonly<SearchContentIndexEntry>> {
	return new Map(Object.entries(entries));
}

function* iterableFromEntries(
	entries: Record<string, SearchContentIndexEntry>,
): Iterable<readonly [string, Readonly<SearchContentIndexEntry>]> {
	for (const [path, entry] of Object.entries(entries)) {
		yield [path, entry] as const;
	}
}

describe("shouldSyncWorkerFileContents", () => {
	it("does not sync when disabled", () => {
		expect(shouldSyncWorkerFileContents(makeState({ sessionEnabled: false }))).toBe(
			false,
		);
	});

	it("does not sync body when title-only", () => {
		expect(
			shouldSyncWorkerFileContents(makeState({ matchScope: "title-only" })),
		).toBe(false);
	});

	it("syncs even while loading in eager mode", () => {
		expect(
			shouldSyncWorkerFileContents(
				makeState({ contentSyncMode: "eager", contentIndexIsLoading: true }),
			),
		).toBe(true);
	});

	it("does not sync while loading in when-idle mode", () => {
		expect(
			shouldSyncWorkerFileContents(
				makeState({
					contentSyncMode: "when-idle",
					contentIndexIsLoading: true,
				}),
			),
		).toBe(false);
	});

	it("syncs after loading completes in when-idle mode", () => {
		expect(
			shouldSyncWorkerFileContents(
				makeState({
					contentSyncMode: "when-idle",
					contentIndexIsLoading: false,
				}),
			),
		).toBe(true);
	});

	it("does not sync with empty query in progressive mode", () => {
		expect(
			shouldSyncWorkerFileContents(
				makeState({ contentSyncMode: "progressive", query: "" }),
			),
		).toBe(false);
	});

	it("does not sync before first tick while loading in progressive mode", () => {
		expect(
			shouldSyncWorkerFileContents(
				makeState({
					contentSyncMode: "progressive",
					contentIndexIsLoading: true,
					progressiveTick: 0,
				}),
			),
		).toBe(false);
	});

	it("syncs after tick in progressive mode", () => {
		expect(
			shouldSyncWorkerFileContents(
				makeState({
					contentSyncMode: "progressive",
					contentIndexIsLoading: true,
					progressiveTick: 1,
				}),
			),
		).toBe(true);
	});

	it("syncs without tick after loading completes in progressive mode", () => {
		expect(
			shouldSyncWorkerFileContents(
				makeState({
					contentSyncMode: "progressive",
					contentIndexIsLoading: false,
					progressiveTick: 0,
				}),
			),
		).toBe(true);
	});
});

describe("diffSearchWorkerFileContents", () => {
	it("returns changed=false when includeContents=false and previous is empty", () => {
		const result = diffSearchWorkerFileContents(
			iterableFromEntries({}),
			new Map(),
			false,
		);
		expect(result.changed).toBe(false);
		expect(result.upserts).toEqual([]);
		expect(result.removals).toEqual([]);
		expect(result.nextEntriesByPath).toBeNull();
	});

	it("keeps active previous entries when includeContents=false", () => {
		const previous = entriesMap({
			"a.md": makeEntry(),
			"b.md": makeEntry(),
		});
		const result = diffSearchWorkerFileContents(
			iterableFromEntries({
				"a.md": makeEntry({ content: "changed while inactive", mtime: 2 }),
				"b.md": makeEntry(),
			}),
			previous,
			false,
		);
		expect(result.changed).toBe(false);
		expect(result.upserts).toEqual([]);
		expect(result.removals).toEqual([]);
		expect(result.nextEntriesByPath).toBeNull();
	});

	it("returns stale removals when includeContents=false and target paths changed", () => {
		const previous = entriesMap({
			"a.md": makeEntry(),
			"b.md": makeEntry(),
		});
		const result = diffSearchWorkerFileContents(
			iterableFromEntries({ "b.md": makeEntry() }),
			previous,
			false,
		);
		expect(result.changed).toBe(true);
		expect(result.upserts).toEqual([]);
		expect(result.removals).toEqual(["a.md"]);
		expect(result.nextEntriesByPath).toEqual(
			entriesMap({ "b.md": previous.get("b.md") as SearchContentIndexEntry }),
		);
	});

	it("upserts new entries", () => {
		const current = { "new.md": makeEntry({ content: "new body", mtime: 10 }) };
		const result = diffSearchWorkerFileContents(
			iterableFromEntries(current),
			new Map(),
			true,
		);
		expect(result.changed).toBe(true);
		expect(result.upserts).toHaveLength(1);
		expect(result.upserts[0]).toEqual({
			path: "new.md",
			content: "new body",
			mtime: 10,
		});
		expect(result.removals).toEqual([]);
	});

	it("upserts entries with changed mtime or content", () => {
		const previous = entriesMap({
			"file.md": makeEntry({ content: "old", mtime: 1 }),
		});
		const current = { "file.md": makeEntry({ content: "new", mtime: 2 }) };
		const result = diffSearchWorkerFileContents(
			iterableFromEntries(current),
			previous,
			true,
		);
		expect(result.changed).toBe(true);
		expect(result.upserts).toHaveLength(1);
		expect(result.upserts[0].content).toBe("new");
	});

	it("adds removed entries to removals", () => {
		const previous = entriesMap({
			"gone.md": makeEntry(),
		});
		const result = diffSearchWorkerFileContents(
			iterableFromEntries({}),
			previous,
			true,
		);
		expect(result.changed).toBe(true);
		expect(result.removals).toEqual(["gone.md"]);
		expect(result.upserts).toEqual([]);
	});

	it("returns changed=false when nothing has changed", () => {
		const entry = makeEntry({ content: "same", mtime: 5 });
		const previous = entriesMap({ "stable.md": entry });
		const current = { "stable.md": entry };
		const result = diffSearchWorkerFileContents(
			iterableFromEntries(current),
			previous,
			true,
		);
		expect(result.changed).toBe(false);
		expect(result.upserts).toEqual([]);
		expect(result.removals).toEqual([]);
		expect(result.nextEntriesByPath).toBeNull();
	});

	it("builds nextEntriesByPath correctly with mixed upserts and removals", () => {
		const previous = entriesMap({
			"keep.md": makeEntry({ content: "keep", mtime: 1 }),
			"gone.md": makeEntry(),
		});
		const current = {
			"keep.md": makeEntry({ content: "keep", mtime: 1 }),
			"new.md": makeEntry({ content: "new", mtime: 3 }),
		};
		const result = diffSearchWorkerFileContents(
			iterableFromEntries(current),
			previous,
			true,
		);
		expect(result.changed).toBe(true);
		expect(result.upserts).toHaveLength(1);
		expect(result.upserts[0].path).toBe("new.md");
		expect(result.removals).toEqual(["gone.md"]);
		expect(result.nextEntriesByPath?.size).toBe(2);
		expect(result.nextEntriesByPath?.has("keep.md")).toBe(true);
		expect(result.nextEntriesByPath?.has("new.md")).toBe(true);
		expect(result.nextEntriesByPath?.has("gone.md")).toBe(false);
	});
});

describe("diffSearchWorkerFileContentsFromVisitor", () => {
	function visitorFromEntries(entries: Record<string, SearchContentIndexEntry>) {
		return (
			visitor: (path: string, entry: Readonly<SearchContentIndexEntry>) => void,
		) => {
			for (const [path, entry] of Object.entries(entries)) {
				visitor(path, entry);
			}
		};
	}

	it("returns changed=false when includeContents=false and previous is empty", () => {
		const result = diffSearchWorkerFileContentsFromVisitor(
			visitorFromEntries({}),
			new Map(),
			false,
		);
		expect(result.changed).toBe(false);
	});

	it("keeps active previous entries when includeContents=false", () => {
		const previous = entriesMap({ "a.md": makeEntry(), "b.md": makeEntry() });
		const result = diffSearchWorkerFileContentsFromVisitor(
			visitorFromEntries({
				"a.md": makeEntry({ content: "changed while inactive", mtime: 2 }),
				"b.md": makeEntry(),
			}),
			previous,
			false,
		);
		expect(result.changed).toBe(false);
		expect(result.upserts).toEqual([]);
		expect(result.removals).toEqual([]);
		expect(result.nextEntriesByPath).toBeNull();
	});

	it("returns stale removals when includeContents=false and target paths changed", () => {
		const previous = entriesMap({ "a.md": makeEntry(), "b.md": makeEntry() });
		const result = diffSearchWorkerFileContentsFromVisitor(
			visitorFromEntries({ "b.md": makeEntry() }),
			previous,
			false,
		);
		expect(result.changed).toBe(true);
		expect(result.upserts).toEqual([]);
		expect(result.removals).toEqual(["a.md"]);
		expect(result.nextEntriesByPath).toEqual(
			entriesMap({ "b.md": previous.get("b.md") as SearchContentIndexEntry }),
		);
	});

	it("upserts new entries via visitor", () => {
		const result = diffSearchWorkerFileContentsFromVisitor(
			visitorFromEntries({
				"new.md": makeEntry({ content: "new body", mtime: 10 }),
			}),
			new Map(),
			true,
		);
		expect(result.changed).toBe(true);
		expect(result.upserts).toHaveLength(1);
		expect(result.upserts[0].content).toBe("new body");
	});

	it("builds nextEntriesByPath correctly with mixed upserts and removals via visitor", () => {
		const previous = entriesMap({
			"keep.md": makeEntry({ content: "keep", mtime: 1 }),
			"gone.md": makeEntry(),
		});
		const result = diffSearchWorkerFileContentsFromVisitor(
			visitorFromEntries({
				"keep.md": makeEntry({ content: "keep", mtime: 1 }),
				"new.md": makeEntry({ content: "new", mtime: 3 }),
			}),
			previous,
			true,
		);
		expect(result.changed).toBe(true);
		expect(result.upserts).toHaveLength(1);
		expect(result.upserts[0].path).toBe("new.md");
		expect(result.removals).toEqual(["gone.md"]);
		expect(result.nextEntriesByPath?.size).toBe(2);
		expect(result.nextEntriesByPath?.has("keep.md")).toBe(true);
		expect(result.nextEntriesByPath?.has("new.md")).toBe(true);
		expect(result.nextEntriesByPath?.has("gone.md")).toBe(false);
	});
});
