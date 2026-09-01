import type { TFile, Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { runStreamingSearch, type StreamingSearchUpdate } from "../streamingSearch";
import type {
	SearchContentMatch,
	SearchItemSnapshot,
	SearchMatchedItem,
} from "../searchTypes";

function createVault(contentsByPath: ReadonlyMap<string, string>): {
	readonly vault: Vault;
	readonly cachedRead: ReturnType<typeof vi.fn>;
} {
	const cachedRead = vi.fn(
		async (file: TFile) => contentsByPath.get(file.path) ?? "",
	);
	return { vault: { cachedRead } as unknown as Vault, cachedRead };
}

function createItem(
	key: string,
	searchText: string,
	targetFilePath: string | null,
): SearchItemSnapshot {
	return { key, searchText, targetFilePath };
}

function getFinalUpdate(updates: readonly StreamingSearchUpdate[]): {
	readonly matchesByKey: ReadonlyMap<string, SearchMatchedItem>;
	readonly firstContentMatchByPath: ReadonlyMap<string, SearchContentMatch>;
} {
	const update = updates.at(-1);
	if (!update?.complete) throw new Error("Search did not publish a final update.");
	const matchesByKey = new Map<string, SearchMatchedItem>();
	const firstContentMatchByPath = new Map<string, SearchContentMatch>();
	for (const current of updates) {
		for (const match of current.addedMatches) matchesByKey.set(match.key, match);
		for (const entry of current.addedContentMatches) {
			if (!firstContentMatchByPath.has(entry.path)) {
				firstContentMatchByPath.set(entry.path, entry.match);
			}
		}
	}
	return { matchesByKey, firstContentMatchByPath };
}

describe("runStreamingSearch", () => {
	it("combines title and content terms while reading each target path once", async () => {
		const file = createMockTFile("notes/shared.md");
		const { vault, cachedRead } = createVault(
			new Map([[file.path, "prefix BETA body\nALPHA later"]]),
		);
		const updates: StreamingSearchUpdate[] = [];

		await runStreamingSearch({
			vault,
			files: [file],
			items: [
				createItem("title-and-body", "alpha title", file.path),
				createItem("body-and-title", "beta title", file.path),
				createItem("missing", "gamma title", null),
			],
			query: "alpha beta",
			scope: "title-and-content",
			isCancelled: () => false,
			onUpdate: (update) => updates.push(update),
		});

		const result = getFinalUpdate(updates);
		expect(Array.from(result.matchesByKey.keys()).sort()).toEqual([
			"body-and-title",
			"title-and-body",
		]);
		expect(result.matchesByKey.get("title-and-body")?.contentMatched).toBe(true);
		expect(cachedRead).toHaveBeenCalledTimes(1);
	});

	it("does not read file contents for a title-only search", async () => {
		const file = createMockTFile("notes/alpha.md");
		const { vault, cachedRead } = createVault(new Map([[file.path, "alpha body"]]));
		const updates: StreamingSearchUpdate[] = [];

		await runStreamingSearch({
			vault,
			files: [file],
			items: [createItem("alpha", "alpha title", file.path)],
			query: "alpha",
			scope: "title-only",
			isCancelled: () => false,
			onUpdate: (update) => updates.push(update),
		});

		expect(getFinalUpdate(updates).matchesByKey.has("alpha")).toBe(true);
		expect(cachedRead).not.toHaveBeenCalled();
	});

	it("ignores WikiLink delimiters when matching title text", async () => {
		const { vault } = createVault(new Map());
		const updates: StreamingSearchUpdate[] = [];

		await runStreamingSearch({
			vault,
			files: [],
			items: [createItem("wikilink-title", "text[[TEXT]]", null)],
			query: "textTEXT",
			scope: "title-only",
			isCancelled: () => false,
			onUpdate: (update) => updates.push(update),
		});

		expect(Array.from(getFinalUpdate(updates).matchesByKey.keys())).toEqual([
			"wikilink-title",
		]);
	});

	it("ignores WikiLink delimiters while preserving raw content offsets", async () => {
		const file = createMockTFile("notes/wikilink.md");
		const { vault } = createVault(
			new Map([[file.path, "prefix text[[TEXT]] and [[tail]]END"]]),
		);
		const updates: StreamingSearchUpdate[] = [];

		await runStreamingSearch({
			vault,
			files: [file],
			items: [createItem("wikilink-content", "unrelated", file.path)],
			query: "textTEXT tailEND",
			scope: "title-and-content",
			isCancelled: () => false,
			onUpdate: (update) => updates.push(update),
		});

		const result = getFinalUpdate(updates);
		expect(Array.from(result.matchesByKey.keys())).toEqual(["wikilink-content"]);
		expect(result.firstContentMatchByPath.get(file.path)).toEqual({
			offset: 7,
			length: 10,
		});
	});

	it("publishes the first content match offset without scanning for line numbers", async () => {
		const file = createMockTFile("notes/alpha.md");
		const plainContent = `${"line\n".repeat(1_000_000)}find alpha here`;
		const wrappedContent = new String(plainContent);
		const charCodeAt = vi.fn(String.prototype.charCodeAt.bind(wrappedContent));
		Object.defineProperty(wrappedContent, "charCodeAt", { value: charCodeAt });
		const { vault } = createVault(
			new Map([[file.path, wrappedContent as unknown as string]]),
		);
		const updates: StreamingSearchUpdate[] = [];

		await runStreamingSearch({
			vault,
			files: [file],
			items: [createItem("alpha", "unrelated", file.path)],
			query: "alpha",
			scope: "title-and-content",
			isCancelled: () => false,
			onUpdate: (update) => updates.push(update),
		});

		const position = getFinalUpdate(updates).firstContentMatchByPath.get(file.path);
		expect(position).toEqual({
			offset: plainContent.length - "alpha here".length,
			length: 5,
		});
		expect(charCodeAt).not.toHaveBeenCalled();
	});

	it("treats regular expression metacharacters as case-insensitive literal text", async () => {
		const exactFile = createMockTFile("notes/exact.md");
		const falsePositiveFile = createMockTFile("notes/false-positive.md");
		const { vault } = createVault(
			new Map([
				[exactFile.path, "Literal A.B then [TAG] and FOO+BAR"],
				[falsePositiveFile.path, "Literal AXB then T and FOOBAR"],
			]),
		);
		const updates: StreamingSearchUpdate[] = [];

		await runStreamingSearch({
			vault,
			files: [exactFile, falsePositiveFile],
			items: [
				createItem("exact", "unrelated", exactFile.path),
				createItem("false-positive", "unrelated", falsePositiveFile.path),
			],
			query: "a.b [tag] foo+bar",
			scope: "title-and-content",
			isCancelled: () => false,
			onUpdate: (update) => updates.push(update),
		});

		const result = getFinalUpdate(updates);
		expect(Array.from(result.matchesByKey.keys())).toEqual(["exact"]);
		expect(result.firstContentMatchByPath.get(exactFile.path)).toEqual({
			offset: 8,
			length: 3,
		});
		expect(result.firstContentMatchByPath.has(falsePositiveFile.path)).toBe(false);
	});

	it("publishes matches only by appending in dataset order", async () => {
		const firstFile = createMockTFile("notes/content-first.md");
		const { vault } = createVault(new Map([[firstFile.path, "alpha in body"]]));
		const updates: StreamingSearchUpdate[] = [];
		let clock = 0;

		await runStreamingSearch({
			vault,
			files: [firstFile],
			items: [
				createItem("content-first", "unrelated", firstFile.path),
				...Array.from({ length: 9 }, (_unused, index) =>
					createItem(`missing-${index}`, "unrelated", null),
				),
				createItem("title-second", "alpha title", null),
			],
			query: "alpha",
			scope: "title-and-content",
			isCancelled: () => false,
			onUpdate: (update) => updates.push(update),
			yieldToMainThread: async () => {},
			now: () => (clock += 20),
		});

		const publishedKeys = updates.map((update) =>
			update.addedMatches.map((match) => match.key),
		);
		expect(publishedKeys).toEqual([["content-first"], ["title-second"]]);
	});

	it("yields after the time budget and stops before publishing stale work", async () => {
		const { vault } = createVault(new Map());
		const items = Array.from({ length: 30 }, (_unused, index) =>
			createItem(`item-${index}`, "alpha", null),
		);
		let cancelled = false;
		const yieldToMainThread = vi.fn(async () => {
			cancelled = true;
		});
		const onUpdate = vi.fn();
		let clock = 0;

		await runStreamingSearch({
			vault,
			files: [],
			items,
			query: "alpha",
			scope: "title-only",
			isCancelled: () => cancelled,
			onUpdate,
			yieldToMainThread,
			now: () => (clock += 6),
		});

		expect(yieldToMainThread).toHaveBeenCalledTimes(1);
		expect(onUpdate.mock.calls.some(([update]) => update.complete)).toBe(false);
	});
});
