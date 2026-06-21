import { describe, expect, test } from "vitest";
import { stripLeadingFrontmatter } from "../frontmatterUtils";

describe("stripLeadingFrontmatter", () => {
	test("removes LF frontmatter", () => {
		const content = `---
title: Test Note
tags: [test, example]
---
This is the actual content.`;

		const result = stripLeadingFrontmatter(content);

		expect(result.removed).toBe(true);
		expect(result.content).toBe("This is the actual content.");
		expect(result.removedLength).toBeGreaterThan(0);
	});

	test("removes CRLF frontmatter", () => {
		const content = [
			"---",
			"title: Test Note",
			"tags: [test, example]",
			"---",
			"This is the actual content.",
		].join("\r\n");

		const result = stripLeadingFrontmatter(content);

		expect(result.removed).toBe(true);
		expect(result.content).toBe("This is the actual content.");
	});

	test("removes frontmatter with BOM", () => {
		const content = `\uFEFF---
title: Test Note
---
Body`;

		const result = stripLeadingFrontmatter(content);

		expect(result.removed).toBe(true);
		expect(result.content).toBe("Body");
	});

	test("does not remove when closing delimiter is missing", () => {
		const content = `---
title: Missing close
Body`;

		const result = stripLeadingFrontmatter(content);

		expect(result.removed).toBe(false);
		expect(result.content).toBe(content);
		expect(result.removedLength).toBe(0);
	});

	test("does not remove --- blocks that are not at the beginning", () => {
		const content = `Intro

---
title: Not frontmatter
---

Body`;

		const result = stripLeadingFrontmatter(content);

		expect(result.removed).toBe(false);
		expect(result.content).toBe(content);
	});
});
