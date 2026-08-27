import type { TFile, Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { runStreamingSearch, type StreamingSearchUpdate } from "../streamingSearch";
import type { SearchItemSnapshot } from "../searchTypes";

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

function getFinalUpdate(
	updates: readonly StreamingSearchUpdate[],
): StreamingSearchUpdate {
	const update = updates.at(-1);
	if (!update?.complete) throw new Error("Search did not publish a final update.");
	return update;
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

	it("publishes the first content match position without retaining content", async () => {
		const file = createMockTFile("notes/alpha.md");
		const { vault } = createVault(
			new Map([[file.path, "first line\nfind alpha here"]]),
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

		const position = getFinalUpdate(updates).firstContentMatchPositionByPath.get(
			file.path,
		);
		expect(position?.start).toEqual({ line: 1, col: 5, offset: 16 });
		expect(position?.end).toEqual({ line: 1, col: 10, offset: 21 });
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
		expect(
			result.firstContentMatchPositionByPath.get(exactFile.path)?.start,
		).toEqual({
			line: 0,
			col: 8,
			offset: 8,
		});
		expect(result.firstContentMatchPositionByPath.has(falsePositiveFile.path)).toBe(
			false,
		);
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
