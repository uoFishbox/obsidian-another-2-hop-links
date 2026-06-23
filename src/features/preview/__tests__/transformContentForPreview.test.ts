import { describe, test, expect } from "vitest";
import { transformContentForPreview } from "../text-processing/textTransformUtils";

describe("transformContentForPreview", () => {
	test("removes frontmatter", () => {
		const content = `---
title: Test
---

# Heading

Some content here.`;
		const result = transformContentForPreview(content);
		expect(result).not.toContain("---");
		expect(result).not.toContain("# Heading");
		expect(result).toContain("Some content here");
	});

	test("handles empty content", () => {
		const content = "";
		const result = transformContentForPreview(content);
		expect(result).toBe("");
	});

	test("preserves headings when preserveHeadings=true", () => {
		const content = `# Heading

Body`;
		const result = transformContentForPreview(content, undefined, {
			preserveHeadings: true,
		});
		expect(result).toContain("# Heading");
		expect(result).toContain("Body");
	});

	test("preserves headings in searchSnippet context", () => {
		const content = `# Heading

Body`;
		const result = transformContentForPreview(content, undefined, {
			context: "searchSnippet",
		});
		expect(result).toContain("# Heading");
		expect(result).toContain("Body");
	});

	test("removes headings in searchSnippet context when preserveHeadings=false", () => {
		const content = `# Heading

Body`;
		const result = transformContentForPreview(content, undefined, {
			context: "searchSnippet",
			preserveHeadings: false,
		});
		expect(result).not.toContain("# Heading");
		expect(result).toContain("Body");
	});

	test("does not convert link syntax inside inline code", () => {
		const content =
			"`[[note]]` `![alt](image.png)` `[Google](https://example.com)`";
		const result = transformContentForPreview(content);
		expect(result).toContain("[[note]]");
		expect(result).toContain("![alt](image.png)");
		expect(result).toContain("[Google](https://example.com)");
		expect(result).not.toContain('class="cosense-card-links__wikilink"');
		expect(result).not.toContain('class="cosense-card-links__external-link"');
	});

	test("does not convert link syntax inside code fences", () => {
		const content = "```md\n[[note]]\n[Google](https://example.com)\n```";
		const result = transformContentForPreview(content);
		expect(result).toContain("[[note]]");
		expect(result).toContain("[Google](https://example.com)");
		expect(result).not.toContain('class="cosense-card-links__wikilink"');
		expect(result).not.toContain('class="cosense-card-links__external-link"');
	});

	test("does not treat a fence line with info string as a closing fence", () => {
		const content = "```md\n[[note]]\n```ts";
		const result = transformContentForPreview(content);
		expect(result).not.toContain('class="cosense-card-links__code-block"');
		expect(result).toContain("[[note]]");
	});

	test("converts permitted code blocks to render blocks", () => {
		const content = "```javascript\nconsole.log(1);\n```";
		const settings = { renderCodeBlockTypes: ["javascript"] } as any;
		const result = transformContentForPreview(content, settings);
		expect(result).toContain('class="twohop-render-block"');
		expect(result).toContain('data-lang="javascript"');
		expect(result).not.toContain('class="cosense-card-links__code-block"');
	});

	test("code protection takes priority over subsequent rules", () => {
		const content = [
			"# Heading",
			"",
			"`[[inline-note]]`",
			"",
			"```md",
			"[[block-note]]",
			"[Google](https://example.com)",
			"```",
			"",
			"[[outside-note]]",
		].join("\n");

		const result = transformContentForPreview(content);
		expect(result).not.toContain("# Heading");
		expect(result).toContain("[[inline-note]]");
		expect(result).toContain("[[block-note]]");
		expect(result).toContain("[Google](https://example.com)");
		const wikilinkCount = (result.match(/cosense-card-links__wikilink/g) || [])
			.length;
		expect(wikilinkCount).toBe(1);
		expect(result).toContain("outside-note");
	});

	test("removes embeds normally but preserves permitted hosts", () => {
		const removed = transformContentForPreview("Before ![[image.png]] After");
		const kept = transformContentForPreview(
			"Before ![](https://youtube.com/watch?v=1) After",
		);
		expect(removed).not.toContain("![[image.png]]");
		expect(removed).toContain("Before");
		expect(removed).toContain("After");
		expect(kept).toContain("https://youtube.com/watch?v=1");
		expect(kept).toContain("Before");
		expect(kept).toContain("After");
	});

	test("leaves iframes without closing tags as normal text", () => {
		const content = "Before <iframe src=x>\nAfter";
		const result = transformContentForPreview(content);
		expect(result).toContain("<iframe src=x>");
		expect(result).toContain("After");
	});
});
