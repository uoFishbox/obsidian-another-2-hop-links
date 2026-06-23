import { describe, test, expect } from "vitest";
import {
	highlightTextForSearch,
	highlightSearchMatchesInHtml,
} from "../searchHighlighter";

describe("highlightTextForSearch", () => {
	test("wraps matching text in ccl-search-highlight span", () => {
		const result = highlightTextForSearch("Notebook Search Result", "search");
		expect(result).toContain('<span class="ccl-search-highlight">Search</span>');
		expect(result).toContain("Notebook ");
		expect(result).toContain(" Result");
	});

	test("handles regex metacharacters literally", () => {
		const result = highlightTextForSearch("Use C++ here", "c++");
		expect(result).toContain('<span class="ccl-search-highlight">C++</span>');
	});

	test("escapes HTML in non-matching text", () => {
		const result = highlightTextForSearch("<script>alert(1)</script>", "alert");
		expect(result).toContain("&lt;script&gt;");
		expect(result).toContain('<span class="ccl-search-highlight">alert</span>');
	});

	test("returns unchanged text when no query", () => {
		expect(highlightTextForSearch("plain text")).toBe("plain text");
	});

	test("returns unchanged text when no match", () => {
		const result = highlightTextForSearch("hello world", "xyz");
		expect(result).toBe("hello world");
	});
});

describe("highlightSearchMatchesInHtml", () => {
	test("highlights text while preserving existing HTML tags", () => {
		const html =
			'<span class="cosense-card-links__wikilink">Search target</span> plain search';
		const result = highlightSearchMatchesInHtml(html, "search");

		expect(result).toContain('class="cosense-card-links__wikilink"');
		expect(result).toContain(
			'<span class="cosense-card-links__wikilink"><span class="ccl-search-highlight">Search</span> target</span>',
		);
		expect(result).toContain(
			'plain <span class="ccl-search-highlight">search</span>',
		);
	});

	test("strips existing ccl-search-highlight before re-highlighting", () => {
		const html =
			'before <span class="ccl-search-highlight">Search</span> after search';
		const result = highlightSearchMatchesInHtml(html, "search");

		expect(result.match(/class="ccl-search-highlight"/g)).toHaveLength(2);
		expect(result).toContain("before ");
		expect(result).toContain(" after ");
	});

	test("returns cleaned content when no query", () => {
		const html = 'before <span class="ccl-search-highlight">Old</span> after';
		const result = highlightSearchMatchesInHtml(html);
		expect(result).toBe("before Old after");
	});

	test("does not highlight matches that only appear inside tags", () => {
		const html = '<span data-label="search">visible text</span>';
		expect(highlightSearchMatchesInHtml(html, "search")).toBe(html);
	});

	test("does not match a literal less-than query across an HTML boundary", () => {
		const html = "visible<span>text</span>";
		expect(highlightSearchMatchesInHtml(html, "visible<")).toBe(html);
	});
});
