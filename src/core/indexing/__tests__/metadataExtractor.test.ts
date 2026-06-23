import { describe, expect, test, vi } from "vitest";
import { extractTags, collectLinkReferences } from "../metadata/metadataExtractor";
import type { CachedMetadataWithLinkReferences } from "types/domain";
import type { CachedMetadata } from "obsidian";

describe("extractTags", () => {
	test("returns shared empty array when no tag info exists", () => {
		const emptyCache = {} as CachedMetadata;
		const noBodyTagsCache = { tags: [] } as CachedMetadata;

		const first = extractTags(null);

		expect(extractTags(emptyCache)).toBe(first);
		expect(extractTags(noBodyTagsCache)).toBe(first);
	});

	test("extracts a single body tag without frontmatter tags", () => {
		const position = {
			start: { line: 0, col: 0, offset: 0 },
			end: { line: 0, col: 6, offset: 6 },
		};
		const cache = {
			tags: [{ tag: "#TagA", position }],
		} as unknown as CachedMetadata;

		expect(extractTags(cache)).toEqual([{ tag: "taga", position }]);
	});

	test("returns shared empty array when a single body tag normalizes to empty", () => {
		const cache = {
			tags: [
				{
					tag: "#",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 1, offset: 1 },
					},
				},
			],
		} as unknown as CachedMetadata;

		expect(extractTags(cache)).toBe(extractTags(null));
	});

	test("extracts a single frontmatter tag without body tags", () => {
		const cache = {
			frontmatter: { tags: ["#TagA"] },
		} as unknown as CachedMetadata;

		expect(extractTags(cache)).toEqual([{ tag: "taga" }]);
	});

	test("returns shared empty array for an invalid single frontmatter tag", () => {
		const cache = {
			frontmatter: { tags: [42] },
		} as unknown as CachedMetadata;

		expect(extractTags(cache)).toBe(extractTags(null));
	});

	test("parses array-form frontmatter tags", () => {
		const cache = {
			frontmatter: { tags: ["tagA", "tagB", "tagC"] },
		} as unknown as CachedMetadata;

		const result = extractTags(cache);

		expect(result.map((t) => t.tag)).toEqual(["taga", "tagb", "tagc"]);
	});

	test("strips leading # from frontmatter array tags", () => {
		const cache = {
			frontmatter: { tags: ["#hello", "#world"] },
		} as unknown as CachedMetadata;

		const result = extractTags(cache);

		expect(result.map((t) => t.tag)).toEqual(["hello", "world"]);
	});

	test("deduplicates frontmatter array tags (case-insensitive)", () => {
		const cache = {
			frontmatter: { tags: ["TagA", "taga", "TAGA"] },
		} as unknown as CachedMetadata;

		const result = extractTags(cache);

		expect(result).toHaveLength(1);
		expect(result[0].tag).toBe("taga");
	});

	test("skips non-string entries in frontmatter tags array", () => {
		const cache = {
			frontmatter: { tags: ["valid", 42, null, "also-valid"] },
		} as unknown as CachedMetadata;

		const result = extractTags(cache);

		expect(result.map((t) => t.tag)).toEqual(["valid", "also-valid"]);
	});

	test("ignores string-form frontmatter tags (Obsidian 1.9+)", () => {
		const cache = {
			frontmatter: { tags: "tagA, tagB" },
		} as unknown as CachedMetadata;

		// string-form is not recognized by Obsidian 1.9+; plugin should ignore it
		const result = extractTags(cache);

		expect(result).toEqual([]);
	});

	test("returns empty for empty frontmatter array", () => {
		const cache = {
			frontmatter: { tags: [] },
		} as unknown as CachedMetadata;

		const result = extractTags(cache);

		expect(result).toEqual([]);
	});

	test("body tags have position info and override frontmatter tags", () => {
		const cache = {
			frontmatter: { tags: ["shared"] },
			tags: [
				{
					tag: "#shared",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 6, offset: 6 },
					},
				},
			],
		} as unknown as CachedMetadata;

		const result = extractTags(cache);

		expect(result).toHaveLength(1);
		expect(result[0].tag).toBe("shared");
		expect(result[0].position).toBeDefined();
	});
});

describe("collectLinkReferences", () => {
	test("returns empty array without calling sort when there are zero link references", async () => {
		const sortSpy = vi.spyOn(Array.prototype, "sort");
		const cache = {
			links: [],
			embeds: [],
			frontmatterLinks: [],
		} as CachedMetadataWithLinkReferences;

		try {
			expect(collectLinkReferences(cache)).toEqual([]);
			expect(sortSpy).not.toHaveBeenCalled();
		} finally {
			sortSpy.mockRestore();
		}
	});
});
