import { describe, expect, test, vi } from "vitest";
import { collectResolverDependencies } from "../ResolverDependencies";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { IMetadataCache } from "types/obsidian";

describe("collectResolverDependencies", () => {
	test("expands origin, branches, backlinks, and tags into dependency sets", () => {
		const originFile = createMockTFile("origin.md");
		const branchTarget = createMockTFile("target.md");
		const hop2File = createMockTFile("hop2.md");
		const backlinkSource = createMockTFile("backlink.md");
		const taggedFile = createMockTFile("tagged.md");
		const metadataCache = {
			getFileCache: vi.fn((file) =>
				file === originFile
					? { tags: [{ tag: "tag/origin" }], embeds: [], links: [] }
					: null,
			),
		} as unknown as IMetadataCache;

		const dependencies = collectResolverDependencies(metadataCache, {
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

		expect(dependencies.dependencyPaths).toEqual(
			new Set(["origin.md", "target.md", "hop2.md", "backlink.md", "tagged.md"]),
		);
		expect(dependencies.dependencyLookupKeys).toEqual(
			new Set(["origin.md", "target.md", "missing.md"]),
		);
		expect(dependencies.dependencyTags).toEqual(new Set(["tag/origin"]));
	});
});
