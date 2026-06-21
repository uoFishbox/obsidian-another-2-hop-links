import { describe, test, expect } from "vitest";
import { getContentSnippet } from "../snippetExtractor";
import type { PluginSettings } from "types/settings";
import { DEFAULT_SETTINGS } from "types/settings";

const defaultSettings: PluginSettings = DEFAULT_SETTINGS;

describe("getContentSnippet", () => {
	describe("basic text processing", () => {
		test("returns plain text as-is", () => {
			expect(getContentSnippet("Hello world.", defaultSettings)).toBe(
				"Hello world.",
			);
		});

		test("returns empty string for empty or whitespace-only input", () => {
			expect(getContentSnippet("", defaultSettings)).toBe("");
			expect(getContentSnippet("   \n\n   ", defaultSettings)).toBe("");
		});

		test("trims leading newlines and trailing whitespace", () => {
			const result = getContentSnippet(
				"\n\n\nContent here.   \n",
				defaultSettings,
			);
			expect(result).toBe("Content here.");
		});
	});

	describe("frontmatter removal", () => {
		test("strips YAML frontmatter and returns body", () => {
			const content = `---
title: Test
tags: [a, b]
---

Actual content.`;
			const result = getContentSnippet(content, defaultSettings);
			expect(result).toBe("Actual content.");
			expect(result).not.toContain("---");
		});

		test("returns empty when only frontmatter exists", () => {
			const result = getContentSnippet(
				"---\ntitle: X\n---",
				defaultSettings,
			);
			expect(result).toBe("");
		});

		test("handles BOM and CRLF frontmatter", () => {
			const bom = getContentSnippet(
				"\uFEFF---\ntitle: X\n---\nBody",
				defaultSettings,
			);
			expect(bom).toBe("Body");

			const crlf = getContentSnippet(
				["---", "title: X", "---", "", "Body"].join("\r\n"),
				defaultSettings,
			);
			expect(crlf).toBe("Body");
		});
	});

	describe("code block transformation", () => {
		test("wraps fenced code blocks in styled span", () => {
			const result = getContentSnippet(
				"```js\nconst x = 42;\n```",
				defaultSettings,
			);
			expect(result).toContain('class="cosense-card-links__code-block"');
			expect(result).toContain("const x = 42;");
			expect(result).not.toContain("```");
		});

		test("wraps inline code in styled span", () => {
			const result = getContentSnippet(
				"Use `console.log()` here.",
				defaultSettings,
			);
			expect(result).toContain('class="cosense-card-links__inline-code"');
			expect(result).toContain("console.log()");
		});

		test("escapes HTML inside code blocks", () => {
			const result = getContentSnippet(
				"```html\n<script>alert(1)</script>\n```",
				defaultSettings,
			);
			expect(result).toContain("&lt;script&gt;");
			expect(result).not.toContain("<script>");
		});

		test("preserves multiple code blocks", () => {
			const content =
				"```python\nprint(1)\n```\n\n```js\nconst x = 1;\n```";
			const result = getContentSnippet(content, defaultSettings);
			expect(
				result.match(/class="cosense-card-links__code-block"/g),
			).toHaveLength(2);
		});
	});

	describe("wiki link transformation", () => {
		test("converts [[Note]] to styled span", () => {
			const result = getContentSnippet(
				"See [[Note Name]].",
				defaultSettings,
			);
			expect(result).toContain('class="cosense-card-links__wikilink');
			expect(result).toContain("Note Name");
		});

		test("displays alias for [[Note|Alias]]", () => {
			const result = getContentSnippet(
				"[[Actual|Display]]",
				defaultSettings,
			);
			expect(result).toContain("Display");
			expect(result).not.toContain("Actual");
		});
	});

	describe("external link transformation", () => {
		test.each([
			{
				label: "HTTPS",
				input: "Visit [Google](https://google.com)",
				expectText: "Google",
				notContain: "https://google.com",
			},
			{
				label: "HTTP",
				input: "See [Site](http://example.com)",
				expectText: "Site",
			},
			{
				label: "custom scheme",
				input: "Open [App](obsidian://vault)",
				expectText: "App",
			},
			{
				label: "bare URL",
				input: "Go to https://example.com now",
				expectText: "https://example.com",
			},
		])(
			"converts $label Markdown/bare links to external-link span",
			({ input, expectText, notContain }) => {
				const result = getContentSnippet(input, defaultSettings);
				expect(result).toContain(
					'class="cosense-card-links__external-link"',
				);
				expect(result).toContain(expectText);
				if (notContain) expect(result).not.toContain(notContain);
			},
		);

		test("treats .md and extensionless links as internal (wikilink)", () => {
			const md = getContentSnippet("[Note](note.md)", defaultSettings);
			expect(md).toContain('class="cosense-card-links__wikilink"');
			expect(md).not.toContain(
				'class="cosense-card-links__external-link"',
			);

			const noExt = getContentSnippet("[Note](note)", defaultSettings);
			expect(noExt).toContain('class="cosense-card-links__wikilink"');
		});

		test("does not double-process URLs inside HTML tags or Markdown links", () => {
			const inHtml = getContentSnippet(
				'<a href="https://x.com">text</a>',
				defaultSettings,
			);
			expect(inHtml).toContain('href="https://x.com"');
			expect(inHtml).not.toContain(
				'<span class="cosense-card-links__external-link">https://x.com</span>',
			);
		});
	});

	describe("embed and structural element removal", () => {
		test("removes embedded images, wiki embeds, and iframes", () => {
			const content =
				"Before\n![img](a.png)\n![[b.pdf]]\n<iframe></iframe>\nAfter";
			const result = getContentSnippet(content, defaultSettings);
			expect(result).not.toContain("![");
			expect(result).not.toContain("![[");
			expect(result).not.toContain("iframe");
			expect(result).toContain("Before");
			expect(result).toContain("After");
		});

		test("strips headings, horizontal rules, list markers, and highlight syntax", () => {
			const content = `# Heading
- Item 1
==highlight==
---
Plain text`;
			const result = getContentSnippet(content, defaultSettings);
			expect(result).not.toContain("# Heading");
			expect(result).not.toMatch(/^[ \t]*-[ \t]+/m);
			expect(result).not.toContain("==");
			expect(result).not.toContain("---");
			expect(result).toContain("Item 1");
			expect(result).toContain("highlight");
			expect(result).toContain("Plain text");
		});
	});

	describe("truncation by chars and lines", () => {
		test("truncates ASCII text at weighted char limit (0.5 per char)", () => {
			const content = "A".repeat(700);
			const result = getContentSnippet(content, {
				...defaultSettings,
				previewMaxChars: 300,
				previewMaxLines: 0,
			});
			expect(result.length).toBeLessThanOrEqual(603);
			expect(result).toContain("...");
		});

		test("truncates CJK text at char limit (1.0 per char)", () => {
			const content = "あ".repeat(350);
			const result = getContentSnippet(content, {
				...defaultSettings,
				previewMaxChars: 300,
				previewMaxLines: 0,
			});
			expect(result.length).toBeLessThanOrEqual(303);
			expect(result).toContain("...");
		});

		test("truncates at line limit", () => {
			const content = Array(20)
				.fill(0)
				.map((_, i) => `Line ${i}`)
				.join("\n");
			const result = getContentSnippet(content, {
				...defaultSettings,
				previewMaxLines: 5,
				previewMaxChars: 0,
			});
			expect(result.split("\n").length).toBeLessThanOrEqual(5);
			expect(result).toContain("...");
		});

		test("truncates long wrapped text by estimated visual lines", () => {
			const content = "あ".repeat(30);
			const result = getContentSnippet(content, {
				...defaultSettings,
				cardWidthPx: 64,
				cardHeightRatio: 2,
				previewMaxLines: 5,
				previewMaxChars: 0,
			});
			expect(result.length).toBeLessThan(content.length + 3);
			expect(result).toContain("...");
		});

		test("adds configured visual line extra lines to preview", () => {
			const content = "あ".repeat(50);
			const baseSettings = {
				...defaultSettings,
				cardWidthPx: 64,
				cardHeightRatio: 2,
				previewMaxLines: 20,
				previewMaxChars: 0,
			};
			const withoutMargin = getContentSnippet(content, {
				...baseSettings,
				previewVisualLineSafetyMargin: 0,
			});
			const withMargin = getContentSnippet(content, {
				...baseSettings,
				previewVisualLineSafetyMargin: 2,
			});

			expect(withMargin.length).toBeGreaterThanOrEqual(
				withoutMargin.length,
			);
		});

		test("no truncation when both limits are 0", () => {
			const content = "A".repeat(1000);
			const result = getContentSnippet(content, {
				...defaultSettings,
				previewMaxChars: 0,
				previewMaxLines: 0,
			});
			expect(result).toBe(content);
			expect(result).not.toContain("...");
		});

		test("truncation preserves balanced span tags", () => {
			const content = "```js\n" + "x".repeat(500) + "\n```";
			const result = getContentSnippet(content, {
				...defaultSettings,
				previewMaxChars: 50,
				previewMaxLines: 0,
			});
			const opens = (result.match(/<span/g) || []).length;
			const closes = (result.match(/<\/span>/g) || []).length;
			expect(opens).toBe(closes);
		});
	});

	describe("math block handling during truncation", () => {
		test("keeps inline math $...$ balanced when truncated", () => {
			const content = "Text $x^2 + " + "y".repeat(500) + "$";
			const result = getContentSnippet(content, {
				...defaultSettings,
				previewMaxChars: 50,
				previewMaxLines: 0,
			});
			const dollars = (result.match(/\$/g) || []).length;
			expect(dollars % 2).toBe(0);
		});

		test("keeps block math $$...$$ balanced when truncated", () => {
			const content =
				"Text $$\n\\frac{1}{2}\n" + "x".repeat(500) + "\n$$";
			const result = getContentSnippet(content, {
				...defaultSettings,
				previewMaxChars: 50,
				previewMaxLines: 0,
			});
			const blockMath = (result.match(/\$\$/g) || []).length;
			expect(blockMath % 2).toBe(0);
		});
	});

	describe("wiki link and code block safety during truncation", () => {
		test("rewinds past unclosed [[ when truncated", () => {
			const result = getContentSnippet("Text [[Link" + "x".repeat(500), {
				...defaultSettings,
				previewMaxChars: 20,
			});
			expect(result).not.toContain("[[");
			expect(result).toContain("Text");
		});

		test("rewinds past unclosed code fence when truncated", () => {
			const result = getContentSnippet(
				"Text\n```\n" + "code\n".repeat(100),
				{
					...defaultSettings,
					previewMaxChars: 30,
				},
			);
			// Code blocks are transformed to spans before truncation,
			// so we verify balanced span tags instead of raw fences.
			const opens = (result.match(/<span/g) || []).length;
			const closes = (result.match(/<\/span>/g) || []).length;
			expect(opens).toBe(closes);
		});
	});

	describe("undefined settings", () => {
		test("no truncation when settings is undefined", () => {
			const content = "A".repeat(1000);
			expect(getContentSnippet(content, undefined)).toBe(content);
		});

		test("hard-caps very large content even without settings", () => {
			const content = "A".repeat(10000);
			const result = getContentSnippet(content, undefined);
			expect(result.length).toBeLessThanOrEqual(2500);
			expect(result).not.toContain("...");
		});
	});

	describe("edge cases", () => {
		test("collapses consecutive newlines and spaces", () => {
			expect(getContentSnippet("A\n\n\n\nB", defaultSettings)).toBe(
				"A\nB",
			);
			expect(getContentSnippet("A     B", defaultSettings)).toBe("A B");
		});

		test("handles nested markdown syntax", () => {
			const result = getContentSnippet(
				"**Bold `code`** and [[Link|Alias]]",
				defaultSettings,
			);
			expect(result).toContain('class="cosense-card-links__inline-code"');
			expect(result).toContain('class="cosense-card-links__wikilink"');
			expect(result).toContain("code");
			expect(result).toContain("Alias");
		});
	});

	describe("complex document", () => {
		test("processes a realistic markdown document correctly", () => {
			const content = `---
title: Complex Note
---

# Main Heading

Intro with **bold**, *italic*, ==highlighted==.

## Section

- Item with [[Link]]
- Item with \`code\`
- Item with [ext](https://example.com)

\`\`\`javascript
function foo() { return 42; }
\`\`\`

After code. $E = mc^2$ math.

![img](x.png)
![[file]]

End.`;

			const result = getContentSnippet(content, {
				...defaultSettings,
				previewMaxChars: 0,
				previewMaxLines: 0,
			});

			expect(result).not.toContain("title:");
			expect(result).not.toContain("# Main");
			expect(result).toContain("Intro with");
			expect(result).toContain('class="cosense-card-links__code-block"');
			expect(result).not.toContain("![");
			expect(result).not.toContain("![[");
			expect(result).toContain('class="cosense-card-links__wikilink');
			expect(result).toContain(
				'class="cosense-card-links__external-link"',
			);
		});
	});
});

describe("getContentSnippet with search query", () => {
	test("seeks to hit location and adds ellipsis on both sides", () => {
		const content =
			"A".repeat(1800) + "\nTarget phrase here.\n" + "B".repeat(1000);
		const result = getContentSnippet(
			content,
			defaultSettings,
			"target phrase",
		);
		expect(result).toContain("Target phrase here.");
		expect(result.startsWith("...")).toBe(true);
		expect(result.endsWith("...")).toBe(true);
	});

	test("recomputes firstMatchIndex after frontmatter removal", () => {
		const content = `---\ntitle: Test\n---\n\n${"A".repeat(1200)} target near end.`;
		const result = getContentSnippet(content, defaultSettings, "target");
		expect(result).toContain("target near end.");
		expect(result).not.toContain("title:");
		expect(result.startsWith("...")).toBe(true);
	});

	test("does not show YAML when keyword only exists in frontmatter", () => {
		const content = `---\ntitle: target note\n---\n\nBody without keyword.`;
		const result = getContentSnippet(content, defaultSettings, "target");
		expect(result).toBe("Body without keyword.");
		expect(result).not.toContain("title:");
	});

	test("accepts precomputed firstMatchIndex option", () => {
		const content = "A".repeat(1200) + " target near end.";
		const firstMatchIndex = content.toLowerCase().indexOf("target");
		const withOpt = getContentSnippet(content, defaultSettings, "target", {
			firstMatchIndex,
		});
		const withoutOpt = getContentSnippet(
			content,
			defaultSettings,
			"target",
		);
		expect(withOpt).toBe(withoutOpt);
	});

	test("literal search with regex metacharacters", () => {
		const result = getContentSnippet(
			"prefix C++ suffix",
			defaultSettings,
			"c++",
		);
		expect(result).toContain("C++");
	});

	test("seeks within threshold using buffer", () => {
		const settings: PluginSettings = {
			...defaultSettings,
			searchPreviewSeekThresholdChars: 20,
			searchPreviewSeekBufferChars: 8,
		};
		const content = "prefix-prefix-prefix-target-suffix";
		const result = getContentSnippet(content, settings, "target");
		const snippet = result.startsWith("...") ? result.slice(3) : result;
		const matchIndex = snippet.toLowerCase().indexOf("target");
		expect(matchIndex).toBeGreaterThanOrEqual(0);
		expect(matchIndex).toBeLessThanOrEqual(8);
	});

	test("preserves fenced code block when search hits inside it", () => {
		const prelude = Array.from({ length: 40 }, (_, i) => `line_${i}`).join(
			"\n",
		);
		const content =
			"prefix\n".repeat(80) +
			"```python\n" +
			prelude +
			"\n# target_hit\nprint(1)\n```\n";
		const result = getContentSnippet(
			content,
			defaultSettings,
			"target_hit",
		);
		expect(result).toContain('class="cosense-card-links__code-block"');
		expect(result).toContain("# target_hit");
		expect(result).not.toContain("\n```");
	});

	test("keeps headings when searching (searchSnippet context)", () => {
		const content = `# Overview\nIntro\n\n## target heading\ndetails`;
		const result = getContentSnippet(
			content,
			defaultSettings,
			"target heading",
		);
		expect(result).toContain("## target heading");
		expect(result).toContain("details");
	});
});

describe("inline code with HTML-like text", () => {
	test("treats html-like text inside raw inline code as visible content", () => {
		const content = "aa `<tag>` bb";
		const result = getContentSnippet(content, defaultSettings);
		expect(result).toContain("tag");
		expect(result).toContain("cosense-card-links__inline-code");
	});

	test("does not skip <tag> as an HTML tag when inside backtick block during truncation", () => {
		// Force fallback path: very small maxChars → transformed HTML is all tags → empty → fallback
		const content = "`<tag>`";
		const result = getContentSnippet(content, {
			...defaultSettings,
			previewMaxChars: 1,
			previewMaxLines: 1,
		});
		// The fallback truncates raw markdown first, then transforms.
		// `<tag>` inside backticks should survive as inline code content.
		expect(result).toContain("tag");
	});
});
