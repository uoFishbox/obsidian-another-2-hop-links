import { describe, expect, test } from "vitest";
import { parseBookmarkedFilePaths } from "cards/hooks/bookmarksUtils";

describe("bookmarksUtils", () => {
	test("extracts only file bookmarks", () => {
		const content = JSON.stringify({
			items: [
				{ type: "file", path: "notes/alpha.md" },
				{ type: "folder", path: "notes" },
				{ type: "search", query: "tag:#x" },
			],
		});

		const parsed = parseBookmarkedFilePaths(content);

		expect(parsed.filePaths).toEqual(new Set(["notes/alpha.md"]));
		expect(parsed.orderedFilePaths).toEqual(["notes/alpha.md"]);
	});

	test("extracts files under nested sections", () => {
		const content = JSON.stringify({
			items: [
				{
					type: "section",
					title: "Nested",
					items: [
						{ type: "file", path: "notes/child.md" },
						{
							type: "section",
							items: [{ type: "file", path: "/notes//deep.md/" }],
						},
					],
				},
			],
		});

		const parsed = parseBookmarkedFilePaths(content);

		expect(parsed.filePaths).toEqual(new Set(["notes/child.md", "notes/deep.md"]));
		expect(parsed.orderedFilePaths).toEqual(["notes/child.md", "notes/deep.md"]);
	});

	test("ignores non-file items", () => {
		const content = JSON.stringify({
			items: [
				{ type: "folder", path: "folder-only" },
				{ type: "graph", query: "x" },
				{ type: "block", path: "note.md#^block-id" },
				{ type: "heading", path: "note.md#section" },
				{ type: "link", path: "https://example.com" },
			],
		});

		const parsed = parseBookmarkedFilePaths(content);

		expect(parsed.filePaths.size).toBe(0);
		expect(parsed.orderedFilePaths).toEqual([]);
	});

	test("returns empty set for invalid JSON", () => {
		const parsed = parseBookmarkedFilePaths("{ invalid-json");
		expect(parsed.filePaths.size).toBe(0);
		expect(parsed.orderedFilePaths).toEqual([]);
	});
});
