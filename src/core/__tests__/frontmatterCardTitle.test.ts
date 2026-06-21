import { describe, expect, it, vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import {
	frontmatterValueToCardTitle,
	getFileCardDisplayTitle,
	getFileCardTitleSearchText,
	getPriorityFrontmatterCardTitle,
} from "../frontmatterCardTitle";

vi.mock("obsidian", () => {
	class MockTFile {
		path = "";
		name = "";
		basename = "";
		extension = "md";
		stat = { ctime: 0, mtime: 0, size: 0 };
		parent: unknown = null;
	}

	return {
		TFile: MockTFile,
	};
});

describe("frontmatterCardTitle", () => {
	it("normalizes primitive and structured frontmatter values", () => {
		expect(frontmatterValueToCardTitle("  Custom Title  ")).toBe(
			"Custom Title",
		);
		expect(frontmatterValueToCardTitle("   ")).toBeNull();
		expect(frontmatterValueToCardTitle(null)).toBeNull();
		expect(frontmatterValueToCardTitle(undefined)).toBeNull();
		expect(frontmatterValueToCardTitle(0)).toBe("0");
		expect(frontmatterValueToCardTitle(false)).toBe("false");
		expect(frontmatterValueToCardTitle(["a", 2, false])).toBe(
			"a, 2, false",
		);
		expect(frontmatterValueToCardTitle({ a: 1 })).toBe(
			JSON.stringify({ a: 1 }),
		);
	});

	it("resolves a priority frontmatter card title only when the key exists and the value is non-empty", () => {
		const file = createMockTFile("notes/example.md");
		const getMetadata = vi.fn(() => ({
			frontmatter: {
				title: " Custom Title ",
				empty: "   ",
				count: 0,
			},
		} as never));

		expect(
			getPriorityFrontmatterCardTitle(file, " title ", getMetadata),
		).toBe("Custom Title");
		expect(getPriorityFrontmatterCardTitle(file, "missing", getMetadata)).toBeNull();
		expect(getPriorityFrontmatterCardTitle(file, "empty", getMetadata)).toBeNull();
		expect(getPriorityFrontmatterCardTitle(file, "", getMetadata)).toBeNull();
	});

	it("falls back to fileToLinktext when no priority frontmatter title is available", () => {
		const file = createMockTFile("notes/example.md");
		const getMetadata = vi.fn(() => ({
			frontmatter: {},
		} as never));
		const fileToLinktext = vi.fn(() => "Example Link");

		expect(
			getFileCardDisplayTitle(file, {
				sourcePath: "notes/source.md",
				fileToLinktext,
				getMetadata,
				priorityFrontmatterKeyForTitle: "title",
			}),
		).toBe("Example Link");
		expect(fileToLinktext).toHaveBeenCalledWith(
			file,
			"notes/source.md",
			true,
		);
	});

	it("builds search text from the resolved title, linktext, basename, and path", () => {
		const file = createMockTFile("notes/example.md");
		const getMetadata = vi.fn(() => ({
			frontmatter: {
				title: "Custom Title",
			},
		} as never));
		const fileToLinktext = vi.fn(() => "Example Link");

		const searchText = getFileCardTitleSearchText(file, {
			sourcePath: "notes/source.md",
			fileToLinktext,
			getMetadata,
			priorityFrontmatterKeyForTitle: "title",
		});

		expect(searchText).toContain("Custom Title");
		expect(searchText).toContain("Example Link");
		expect(searchText).toContain("example");
		expect(searchText).toContain("notes/example.md");
	});
});
