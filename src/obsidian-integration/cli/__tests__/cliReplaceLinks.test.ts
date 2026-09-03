import type { LinkCache } from "obsidian";
import { describe, expect, it } from "vitest";
import { replaceCliLinks } from "../cliReplaceLinks";
import { createCliTestVault } from "./cliTestVault";

function reference(
	original: string,
	link: string,
	offset: number,
	displayText?: string,
): LinkCache {
	return {
		original,
		link,
		displayText,
		position: {
			start: { line: 0, col: offset, offset },
			end: {
				line: 0,
				col: offset + original.length,
				offset: offset + original.length,
			},
		},
	};
}

describe("CLI link replacement", () => {
	it("updates only cached links and embeds, retaining aliases and heading anchors", async () => {
		const content = "Old plain [[Old#Heading|Label]] ![[Old]] `[[Old]]`";
		const vault = createCliTestVault({
			"Source.md": content,
			"Old.md": "",
			"New.md": "",
		});
		vault.metadata.set("Source.md", {
			links: [
				reference(
					"[[Old#Heading|Label]]",
					"Old#Heading",
					content.indexOf("[[Old#"),
					"Label",
				),
			],
			embeds: [reference("![[Old]]", "Old", content.indexOf("![["))],
		});
		const context = { host: vault.host, signal: new AbortController().signal };
		const params = { from: "Old.md", to: "New.md", dryRun: true };
		expect(await replaceCliLinks(context, params)).toMatchObject({
			ok: true,
			linkCount: 2,
			updated: ["Source.md"],
		});
		expect(vault.process).not.toHaveBeenCalled();
		expect(
			await replaceCliLinks(context, { ...params, dryRun: false }),
		).toMatchObject({ ok: true, linkCount: 2 });
		expect(vault.contents.get("Source.md")).toBe(
			"Old plain [[New#Heading|Label]] ![[New]] `[[Old]]`",
		);
	});

	it("reports stale metadata without changing unrelated text", async () => {
		const vault = createCliTestVault({
			"Source.md": "edited [[Old]]",
			"Old.md": "",
		});
		vault.metadata.set("Source.md", { links: [reference("[[Old]]", "Old", 0)] });
		expect(
			await replaceCliLinks(
				{ host: vault.host, signal: new AbortController().signal },
				{ from: "Old.md", to: "Missing.md", dryRun: false },
			),
		).toMatchObject({
			ok: false,
			updated: [],
			failed: [{ path: "Source.md" }],
		});
		expect(vault.process).not.toHaveBeenCalled();
		expect(vault.contents.get("Source.md")).toBe("edited [[Old]]");
	});

	it("returns successful and conflicting files separately when a write races", async () => {
		const vault = createCliTestVault({
			"First.md": "[[Old]]",
			"Second.md": "[[Old]]",
			"Old.md": "",
		});
		for (const path of ["First.md", "Second.md"])
			vault.metadata.set(path, { links: [reference("[[Old]]", "Old", 0)] });
		vault.process.mockImplementationOnce(async (file, transform) => {
			const after = transform("concurrent edit");
			vault.contents.set(file.path, after);
			return after;
		});
		expect(
			await replaceCliLinks(
				{ host: vault.host, signal: new AbortController().signal },
				{ from: "Old.md", to: "Missing.md", dryRun: false },
			),
		).toMatchObject({
			ok: false,
			updated: ["Second.md"],
			failed: [{ path: "First.md" }],
			linkCount: 1,
		});
		expect(vault.contents.get("First.md")).toBe("concurrent edit");
		expect(vault.contents.get("Second.md")).toBe("[[Missing]]");
	});
});
