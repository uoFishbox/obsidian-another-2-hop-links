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
});

describe("htmlVisibleTextContainsCaseInsensitive", () => {
	it("matches visible text across HTML tag boundaries", () => {
		const html = "<span>hello</span> <strong>world</strong>";
		expect(htmlVisibleTextContainsCaseInsensitive(html, "hello world")).toBe(true);
	});

	it("does not match text that only appears inside tags", () => {
		const html = '<div class="hello">visible</div>';
		expect(htmlVisibleTextContainsCaseInsensitive(html, "hello")).toBe(false);
		expect(htmlVisibleTextContainsCaseInsensitive(html, "visible")).toBe(true);
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

	it("does not decode HTML entities (consistent with stripHtmlTags)", () => {
		// &lt; は literal として扱い、'< ' には match しない
		const html = "<p>a &lt; b</p>";
		expect(htmlVisibleTextContainsCaseInsensitive(html, "a &lt; b")).toBe(true);
		expect(htmlVisibleTextContainsCaseInsensitive(html, "a < b")).toBe(false);
	});
});
