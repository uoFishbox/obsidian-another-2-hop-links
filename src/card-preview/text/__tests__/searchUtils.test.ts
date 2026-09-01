import { describe, expect, it } from "vitest";
import {
	createCaseInsensitiveRegExp,
	findCaseInsensitiveIndex,
	htmlVisibleTextContainsCaseInsensitive,
} from "../searchUtils";

describe("searchUtils", () => {
	it("treats space-separated query terms as separate matches", () => {
		const pattern = createCaseInsensitiveRegExp("alpha   beta", true);

		expect("Alpha gamma beta".match(pattern ?? /$^/g)).toEqual(["Alpha", "beta"]);
	});

	it("prefers longer terms that start at the same position", () => {
		const pattern = createCaseInsensitiveRegExp("a alpha", true);

		expect("alpha".match(pattern ?? /$^/g)).toEqual(["alpha"]);
	});

	it("finds the first matching query term", () => {
		expect(findCaseInsensitiveIndex("before beta then alpha", "alpha beta")).toBe(
			7,
		);
	});

	it("finds adjacent text across WikiLink delimiters", () => {
		expect(findCaseInsensitiveIndex("before text[[TEXT]] after", "textTEXT")).toBe(
			7,
		);
		expect(findCaseInsensitiveIndex("before [[text]]TEXT after", "textTEXT")).toBe(
			9,
		);
	});
});

describe("htmlVisibleTextContainsCaseInsensitive", () => {
	it("matches visible text across HTML tag boundaries", () => {
		const html = "<span>hello</span> <strong>world</strong>";
		expect(htmlVisibleTextContainsCaseInsensitive(html, "hello world")).toBe(true);
	});

	it("matches visible text across multiple adjacent HTML tags", () => {
		const html = "<span>he</span><i></i><strong>llo</strong> world";
		expect(htmlVisibleTextContainsCaseInsensitive(html, "hello world")).toBe(true);
	});

	it("does not match text that only appears inside tags", () => {
		const html = '<div class="hello">visible</div>';
		expect(htmlVisibleTextContainsCaseInsensitive(html, "hello")).toBe(false);
		expect(htmlVisibleTextContainsCaseInsensitive(html, "visible")).toBe(true);
	});

	it("does not start a match in tag names or attributes", () => {
		const html =
			'<search-target data-query="hidden needle">visible</search-target>';
		expect(htmlVisibleTextContainsCaseInsensitive(html, "search-target")).toBe(
			false,
		);
		expect(htmlVisibleTextContainsCaseInsensitive(html, "hidden needle")).toBe(
			false,
		);
	});

	it("keeps inline-code html-like text visible for query detection", () => {
		const html = "<code>&lt;tag&gt;</code>";
		expect(htmlVisibleTextContainsCaseInsensitive(html, "tag")).toBe(true);
		expect(htmlVisibleTextContainsCaseInsensitive(html, "<tag>")).toBe(false);
	});

	it("returns false for empty query", () => {
		expect(htmlVisibleTextContainsCaseInsensitive("<b>text</b>", "")).toBe(false);
	});

	it("returns false when needle is not in visible text", () => {
		expect(htmlVisibleTextContainsCaseInsensitive("<p>hello</p>", "world")).toBe(
			false,
		);
	});

	it("treats an unclosed angle bracket as visible text", () => {
		expect(
			htmlVisibleTextContainsCaseInsensitive("before <unfinished", "<unfinished"),
		).toBe(true);
	});

	it("handles repeated query prefixes without changing the result", () => {
		const html = `<span>${"a".repeat(2_500)}</span>`;
		const query = `${"a".repeat(80)}b`;

		expect(htmlVisibleTextContainsCaseInsensitive(html, query)).toBe(false);
	});

	it("does not decode HTML entities (consistent with stripHtmlTags)", () => {
		// &lt; は literal として扱い、'< ' には match しない
		const html = "<p>a &lt; b</p>";
		expect(htmlVisibleTextContainsCaseInsensitive(html, "a &lt; b")).toBe(true);
		expect(htmlVisibleTextContainsCaseInsensitive(html, "a < b")).toBe(false);
	});
});
