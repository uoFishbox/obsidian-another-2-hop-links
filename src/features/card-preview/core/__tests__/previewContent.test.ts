import { describe, expect, test, vi } from "vitest";
import { resolveEmbeddedMediaPreview } from "../../strategies/EmbeddedMediaStrategy";
import { canvasToSearchText } from "../../text-processing/canvasText";
import { analyzePreviewContent } from "../previewContent";
import {
	createMockTFileAsPlainObject,
	createMockVault,
} from "testing/__mocks__/testHelpers";
import type { IMetadataCache } from "types/obsidian";

function createEmbeddedMediaStrategy() {
	return { generate: resolveEmbeddedMediaPreview };
}

describe("canvasToSearchText", () => {
	test("converts Canvas nodes to search text in order", () => {
		const result = canvasToSearchText({
			nodes: [
				{ id: "text-1", type: "text", text: " first\r\nline " },
				{ id: "file-1", type: "file", file: "Note.md", subpath: "#Heading" },
				{ id: "link-1", type: "link", url: " https://example.com " },
				{ id: "group-1", type: "group", label: " Group " },
				{ id: "unknown-1", type: "unknown", text: "ignored" },
			],
		});

		expect(result.entries).toEqual([
			{ id: "text-1", type: "text", value: "first\nline" },
			{ id: "file-1", type: "file", value: "Note.md#Heading" },
			{ id: "link-1", type: "link", value: "https://example.com" },
			{ id: "group-1", type: "group", value: "Group" },
		]);
		expect(result.searchableText).toBe(
			"first\nline\nNote.md#Heading\nhttps://example.com\nGroup",
		);
	});
});

describe("analyzePreviewContent", () => {
	test("returns fallback analysis when content has no dollar signs", () => {
		const content = "<p>No math here</p>";

		expect(analyzePreviewContent(content)).toEqual({
			hasDollar: false,
			hasMathExpression: false,
			contentForMathParsing: content,
			protectedSegments: [],
		});
	});

	test("detects inline and block math outside protected segments", () => {
		const analysis = analyzePreviewContent("First $a + b$ and $$c = d$$");

		expect(analysis.hasDollar).toBe(true);
		expect(analysis.hasMathExpression).toBe(true);
		expect(analysis.protectedSegments).toEqual([]);
	});

	test("does not treat dollar signs inside code blocks as math", () => {
		const content = '<span class="cosense-card-links__code-block">$test$</span>';
		const analysis = analyzePreviewContent(content);

		expect(analysis.hasDollar).toBe(true);
		expect(analysis.hasMathExpression).toBe(false);
		expect(analysis.protectedSegments).toHaveLength(1);
		expect(analysis.protectedSegments[0].html).toBe(content);
		expect(analysis.contentForMathParsing).toBe(
			analysis.protectedSegments[0].token,
		);
	});

	test("keeps math outside protected segments visible to the analyzer", () => {
		const content =
			'outside $x^2$ <span class="cosense-card-links__code-block">$test$</span>';
		const analysis = analyzePreviewContent(content);

		expect(analysis.hasMathExpression).toBe(true);
		expect(analysis.protectedSegments).toHaveLength(1);
		expect(analysis.contentForMathParsing).toContain("outside $x^2$");
		expect(analysis.contentForMathParsing).not.toContain("$test$");
	});
});

describe("EmbeddedMediaStrategy", () => {
	test("returns image preview only when an image file can be resolved", async () => {
		const strategy = createEmbeddedMediaStrategy();
		const file = createMockTFileAsPlainObject("note.md");
		const imageFile = createMockTFileAsPlainObject("images/cover.png", "png");
		const metadataCache = {
			getFileCache: vi.fn().mockReturnValue({}),
			getFirstLinkpathDest: vi.fn().mockReturnValue(imageFile),
		} as unknown as IMetadataCache;

		const result = await strategy.generate(file, {
			vault: createMockVault(),
			metadataCache,
			getFirstEmbeddedMedia: vi.fn().mockResolvedValue({
				syntax: "markdown",
				original: `![](images/cover.png)`,
				target: "images/cover.png",
			}),
		} as any);

		expect(result).toEqual({
			type: "image",
			content: `app://local/${imageFile.path}`,
		});
	});

	test("does not treat embeds to Markdown notes as images", async () => {
		const strategy = createEmbeddedMediaStrategy();
		const file = createMockTFileAsPlainObject("note.md");
		const linkedNote = createMockTFileAsPlainObject("linked-note.md");
		const metadataCache = {
			getFileCache: vi.fn().mockReturnValue({}),
			getFirstLinkpathDest: vi.fn().mockReturnValue(linkedNote),
		} as unknown as IMetadataCache;

		const result = await strategy.generate(file, {
			vault: createMockVault(),
			metadataCache,
			getFirstEmbeddedMedia: vi.fn().mockResolvedValue({
				syntax: "markdown",
				original: `![](linked-note.md)`,
				target: "linked-note.md",
			}),
		} as any);

		expect(result).toBeUndefined();
	});

	test("treats http(s) URLs in Markdown image syntax as image preview even without extension", async () => {
		const strategy = createEmbeddedMediaStrategy();
		const file = createMockTFileAsPlainObject("note.md");
		const imageUrl = "https://example.com/api/image?id=123";
		const metadataCache = {
			getFileCache: vi.fn().mockReturnValue({}),
			getFirstLinkpathDest: vi.fn().mockReturnValue(undefined),
		} as unknown as IMetadataCache;

		const result = await strategy.generate(file, {
			vault: createMockVault(),
			metadataCache,
			getFirstEmbeddedMedia: vi.fn().mockResolvedValue({
				syntax: "markdown",
				original: `![](${imageUrl})`,
				target: imageUrl,
			}),
		} as any);

		expect(result).toEqual({ type: "image", content: imageUrl });
	});

	test.each([
		"https://x.com/user/status/123",
		"https://twitter.com/user/status/123",
		"https://youtube.com/watch?v=123",
		"https://youtu.be/123",
		"https://www.youtube.com/watch?v=123",
	])("Markdown embed %s is not treated as an image", async (embedUrl) => {
		const strategy = createEmbeddedMediaStrategy();
		const file = createMockTFileAsPlainObject("note.md");
		const metadataCache = {
			getFileCache: vi.fn().mockReturnValue({}),
			getFirstLinkpathDest: vi.fn().mockReturnValue(undefined),
		} as unknown as IMetadataCache;

		const result = await strategy.generate(file, {
			vault: createMockVault(),
			metadataCache,
			getFirstEmbeddedMedia: vi.fn().mockResolvedValue({
				syntax: "markdown",
				original: `![](${embedUrl})`,
				target: embedUrl,
			}),
		} as any);

		expect(result).toBeUndefined();
	});

	test("does not treat external URLs in Wiki embeds as Markdown images", async () => {
		const strategy = createEmbeddedMediaStrategy();
		const file = createMockTFileAsPlainObject("note.md");
		const imageUrl = "https://example.com/api/image?id=123";
		const metadataCache = {
			getFileCache: vi.fn().mockReturnValue({}),
			getFirstLinkpathDest: vi.fn().mockReturnValue(undefined),
		} as unknown as IMetadataCache;

		const result = await strategy.generate(file, {
			vault: createMockVault(),
			metadataCache,
			getFirstEmbeddedMedia: vi.fn().mockResolvedValue({
				syntax: "wiki",
				original: `![[${imageUrl}]]`,
				target: imageUrl,
			}),
		} as any);

		expect(result).toBeUndefined();
	});

	test("does not finalize preview for non-image files in Wiki embeds", async () => {
		const strategy = createEmbeddedMediaStrategy();
		const file = createMockTFileAsPlainObject("note.md");
		const linkedNote = createMockTFileAsPlainObject("linked-note.md");
		const metadataCache = {
			getFileCache: vi.fn().mockReturnValue({
				embeds: [{ original: "![[linked-note]]", link: "linked-note" }],
			}),
			getFirstLinkpathDest: vi.fn().mockReturnValue(linkedNote),
		} as unknown as IMetadataCache;

		const result = await strategy.generate(file, {
			vault: createMockVault(),
			metadataCache,
		} as any);

		expect(result).toBeUndefined();
	});

	test("does not finalize preview for non-image files in Markdown embeds", async () => {
		const strategy = createEmbeddedMediaStrategy();
		const file = createMockTFileAsPlainObject("note.md");
		const linkedNote = createMockTFileAsPlainObject("linked-note.md");
		const metadataCache = {
			getFileCache: vi.fn().mockReturnValue({
				embeds: [{ original: "![](linked-note.md)", link: "linked-note.md" }],
			}),
			getFirstLinkpathDest: vi.fn().mockReturnValue(linkedNote),
		} as unknown as IMetadataCache;

		const result = await strategy.generate(file, {
			vault: createMockVault(),
			metadataCache,
		} as any);

		expect(result).toBeUndefined();
	});

	test("uses metadata cache embeds without calling body extraction", async () => {
		const strategy = createEmbeddedMediaStrategy();
		const file = createMockTFileAsPlainObject("note.md");
		const imageFile = createMockTFileAsPlainObject("cached.png", "png");
		const metadataCache = {
			getFileCache: vi.fn().mockReturnValue({
				embeds: [{ original: "![[cached.png]]", link: "cached.png" }],
			}),
			getFirstLinkpathDest: vi.fn().mockReturnValue(imageFile),
		} as unknown as IMetadataCache;
		const getFirstEmbeddedMedia = vi.fn().mockResolvedValue({
			syntax: "wiki",
			original: "![[body.png]]",
			target: "body.png",
		});

		const result = await strategy.generate(file, {
			vault: createMockVault(),
			metadataCache,
			getFirstEmbeddedMedia,
		} as any);

		expect(result).toEqual({
			type: "image",
			content: `app://local/${imageFile.path}`,
		});
		expect(getFirstEmbeddedMedia).not.toHaveBeenCalled();
	});
});
