import { describe, expect, test } from "vitest";
import {
	extractFirstEmbeddedMedia,
	stripCodeSegmentsForEmbedDetection,
} from "../mediaExtractor";

describe("extractFirstEmbeddedMedia", () => {
	test("returns the first wiki embed without scanning later content", async () => {
		const embed = await extractFirstEmbeddedMedia(
			"intro ![[Images/photo.png|cover]]\n" + "x".repeat(10_000),
		);

		expect(embed).toEqual({
			syntax: "wiki",
			original: "![[Images/photo.png|cover]]",
			target: "Images/photo.png",
		});
	});

	test("skips embeds inside fenced code blocks and inline code", async () => {
		const embed = await extractFirstEmbeddedMedia(
			[
				"```md",
				"![[inside-fence.png]]",
				"```",
				"inline `![[inside-inline.png]]`",
				"outside ![[outside.png]]",
			].join("\n"),
		);

		expect(embed?.target).toBe("outside.png");
	});

	test("does not treat a fence with info text as a closing fence", () => {
		const stripped = stripCodeSegmentsForEmbedDetection(
			[
				"```md",
				"![[inside-fence.png]]",
				"```ts",
				"![[still-not-closed.png]]",
			].join("\n"),
		);

		expect(stripped).toContain("![[inside-fence.png]]");
		expect(stripped).toContain("![[still-not-closed.png]]");
	});

	test("parses markdown image embeds", async () => {
		const embed = await extractFirstEmbeddedMedia(
			'cover ![Alt text](<assets/cover image.png> "Title")',
		);

		expect(embed).toEqual({
			syntax: "markdown",
			original: '![Alt text](<assets/cover image.png> "Title")',
			target: "assets/cover image.png",
		});
	});

	test("stops at scan budget before later embeds", async () => {
		const embed = await extractFirstEmbeddedMedia(
			"intro\n" + "x".repeat(100) + "![[late.png]]",
			{ maxScanChars: 20 },
		);

		expect(embed).toBeUndefined();
	});

	test("yields during long scans and observes abort", async () => {
		const controller = new AbortController();
		const yieldToMainThread = async () => {
			controller.abort();
		};

		const embed = await extractFirstEmbeddedMedia(
			"x".repeat(30) + "![[late.png]]",
			{
				signal: controller.signal,
				yieldEveryChars: 10,
				yieldToMainThread,
			},
		);

		expect(embed).toBeUndefined();
	});
});
