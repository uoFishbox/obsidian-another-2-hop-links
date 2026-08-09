import type { CachedMetadata } from "obsidian";
import { describe, expect, test } from "vitest";
import { collectResolverDependencies } from "../ResolverDependencies";
import { createMockTFile } from "testing/__mocks__/testHelpers";

describe("collectResolverDependencies", () => {
	test("expands origin, branches, backlinks, and tags into dependency sets", () => {
		const originFile = createMockTFile("origin.md");
		const branchTarget = createMockTFile("target.md");
		const hop2File = createMockTFile("hop2.md");
		const backlinkSource = createMockTFile("backlink.md");
		const taggedFile = createMockTFile("tagged.md");
		const originMetadata = {
			tags: [{ tag: "#Tag/Origin" }],
			embeds: [],
			links: [],
		} as unknown as CachedMetadata;

		const dependencies = collectResolverDependencies(originMetadata, {
			originFile,
			branches: [
				{
					hop1: {
						rawText: "target",
						path: branchTarget.path,
						isUnresolved: false,
						sourceFile: originFile,
					},
					hop2: [
						{
							rawText: "hop2",
							path: hop2File.path,
							isUnresolved: false,
							sourceFile: hop2File,
						},
					],
				},
				{
					hop1: {
						rawText: "Missing",
						path: undefined,
						isUnresolved: true,
						sourceFile: originFile,
					},
					hop2: [],
				},
			],
			backlinks: [
				{
					rawText: "origin",
					path: originFile.path,
					isUnresolved: false,
					sourceFile: backlinkSource,
				},
			],
			taggedNotes: [
				{
					file: taggedFile,
					path: taggedFile.path,
					commonTags: ["tag/origin"],
				},
			],
		});

		expect(dependencies.originPath).toBe("origin.md");
		expect(dependencies.relevantPaths).toEqual(
			new Set(["origin.md", "target.md", "hop2.md", "backlink.md", "tagged.md"]),
		);
		expect(dependencies.relevantLookupKeys).toEqual(
			new Set(["origin.md", "target.md", "missing.md"]),
		);
		expect(dependencies.relevantTags).toEqual(new Set(["tag/origin"]));
		expect(dependencies.structuralSourcePaths).toEqual(
			new Set(["origin.md", "target.md", "backlink.md", "tagged.md"]),
		);
	});
});
