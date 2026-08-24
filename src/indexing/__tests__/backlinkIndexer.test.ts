import { describe, test, expect, vi } from "vitest";
import {
	buildDetailedBacklinksArtifactsChunked,
	dedupeBySourceFile,
} from "../backlink-builder/backlinkIndexer";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import type { IndexedLink } from "indexing/model";
import { type CachedMetadata, type TFile } from "obsidian";
import {
	createResolvedLinkMemo,
	visitResolvedBacklinkRefsUnorderedAsync,
} from "../backlink-builder/backlinkReferenceSequence";
import { createLinkResolutionAmbiguityDetector } from "../link-resolution/linkResolution";
import { HEAVY_YIELD_CHECK_INTERVAL, type YieldScheduler } from "../timeSlicing";

function tfile(path: string): TFile {
	const extension = path.split(".").pop() ?? "";
	return { path, extension } as TFile;
}

function indexedLink(
	sourcePath: string,
	overrides: Partial<IndexedLink> = {},
): IndexedLink {
	return {
		rawText: "[[target]]",
		path: "target.md",
		displayText: undefined,
		isUnresolved: false,
		sourceFile: tfile(sourcePath),
		position: undefined,
		...overrides,
	};
}

describe("dedupeBySourceFile", () => {
	test("keeps the first link per source path", () => {
		const links = [
			indexedLink("note1.md", { rawText: "[[a]]" }),
			indexedLink("note1.md", { rawText: "[[b]]" }),
			indexedLink("note1.md", { rawText: "[[c]]" }),
		];

		const result = dedupeBySourceFile(links);

		expect(result).toHaveLength(1);
		expect(result[0].sourceFile.path).toBe("note1.md");
		expect(result[0].rawText).toBe("[[a]]");
	});

	test("keeps links from different source paths", () => {
		const links = [
			indexedLink("note1.md"),
			indexedLink("note2.md"),
			indexedLink("note3.md"),
		];

		const result = dedupeBySourceFile(links);

		expect(result).toHaveLength(3);
		expect(result.map((l) => l.sourceFile.path)).toEqual([
			"note1.md",
			"note2.md",
			"note3.md",
		]);
	});

	test("excludes links from excludePath", () => {
		const links = [
			indexedLink("note1.md"),
			indexedLink("note2.md"),
			indexedLink("note3.md"),
		];

		const result = dedupeBySourceFile(links, "note2.md");

		expect(result).toHaveLength(2);
		expect(result.map((l) => l.sourceFile.path)).toEqual(["note1.md", "note3.md"]);
	});

	test("returns an empty array for empty input", () => {
		const result = dedupeBySourceFile([]);
		expect(result).toHaveLength(0);
	});
});

describe("buildDetailedBacklinksArtifactsChunked", () => {
	test("builds resolved backlink buckets by destination and source", async () => {
		const { mockVault, mockMetadataCache, files } = new VaultEnvironmentBuilder([
			{ path: "source.md" },
			{ path: "target.md" },
		]).build();

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "source.md") {
				return {
					links: [
						{
							link: "target",
							original: "[[target|late]]",
							displayText: "late",
							position: {
								start: { line: 0, col: 0, offset: 120 },
								end: { line: 0, col: 14, offset: 134 },
							},
						},
						{
							link: "target",
							original: "[[target|early]]",
							displayText: "early",
							position: {
								start: { line: 0, col: 0, offset: 10 },
								end: { line: 0, col: 15, offset: 25 },
							},
						},
					],
					embeds: [],
					headings: [],
					sections: [],
					tags: [],
					frontmatter: undefined,
					frontmatterPosition: undefined,
					frontmatterLinks: undefined,
				} as CachedMetadata;
			}

			return {
				links: [],
				embeds: [],
				headings: [],
				sections: [],
				tags: [],
				frontmatter: undefined,
				frontmatterPosition: undefined,
				frontmatterLinks: undefined,
			} as CachedMetadata;
		});
		(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
			(linkText: string) => {
				if (linkText === "target") {
					return files["target.md"];
				}
				return null;
			},
		);

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{},
		);
		const collection = artifacts.detailedMap.get("target.md")?.get("source.md");

		expect(collection).toBeDefined();
		expect(collection?.count).toBe(2);
		expect(collection?.hasResolved).toBe(true);
		const representative =
			artifacts.sourceSummaries.get("source.md")?.orderedReferences[0];
		expect(representative).toMatchObject({ rawText: "target" });
		expect(representative).not.toHaveProperty("displayText");
	});

	test("indexes links, embeds, and frontmatter links", async () => {
		const { mockVault, mockMetadataCache, files } = new VaultEnvironmentBuilder([
			{ path: "source.md" },
			{ path: "target-link.md" },
			{ path: "target-embed.md" },
			{ path: "target-frontmatter.md" },
		]).build();

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "source.md") {
				return {
					links: [
						{
							link: "target-link",
							original: "[[target-link]]",
							position: {
								start: { line: 0, col: 0, offset: 10 },
								end: { line: 0, col: 15, offset: 25 },
							},
						},
					],
					embeds: [
						{
							link: "target-embed",
							original: "![[target-embed]]",
							position: {
								start: { line: 1, col: 0, offset: 30 },
								end: { line: 1, col: 17, offset: 47 },
							},
						},
					],
					headings: [],
					sections: [],
					tags: [],
					frontmatter: undefined,
					frontmatterPosition: undefined,
					frontmatterLinks: [
						{
							key: "related",
							link: "target-frontmatter",
							original: "target-frontmatter",
						},
					],
				} as CachedMetadata;
			}

			return {
				links: [],
				embeds: [],
				headings: [],
				sections: [],
				tags: [],
				frontmatter: undefined,
				frontmatterPosition: undefined,
				frontmatterLinks: undefined,
			} as CachedMetadata;
		});
		(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
			(linkText: string) => {
				if (linkText === "target-link") {
					return files["target-link.md"];
				}
				if (linkText === "target-embed") {
					return files["target-embed.md"];
				}
				if (linkText === "target-frontmatter") {
					return files["target-frontmatter.md"];
				}
				return null;
			},
		);

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{},
		);

		expect(artifacts.detailedMap.get("target-link.md")?.has("source.md")).toBe(
			true,
		);
		expect(artifacts.detailedMap.get("target-embed.md")?.has("source.md")).toBe(
			true,
		);
		expect(
			artifacts.detailedMap.get("target-frontmatter.md")?.has("source.md"),
		).toBe(true);
		expect(
			new Set(artifacts.sourceSummaries.get("source.md")?.lookupEntries.keys()),
		).toEqual(
			new Set(["target-link.md", "target-embed.md", "target-frontmatter.md"]),
		);

		const sourceSummary = artifacts.sourceSummaries.get("source.md");
		const frontmatterDestination = sourceSummary?.destinations.get(
			"target-frontmatter.md",
		);
		const frontmatterRef =
			frontmatterDestination && sourceSummary
				? sourceSummary.orderedReferences[frontmatterDestination.firstRefIndex]
				: undefined;
		expect(frontmatterRef).toBeDefined();
		expect(frontmatterRef).not.toHaveProperty("key");
	});

	test("normalizes resolved lookup keys from destination paths", async () => {
		const { mockVault, mockMetadataCache, files } = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["note"] },
			{ path: "Note.md" },
		]).build();
		(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
			(linkText: string) => {
				if (linkText === "note") {
					return files["Note.md"];
				}
				return null;
			},
		);

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{},
		);

		expect(artifacts.linkLookupToSources.get("note.md")).toEqual(
			new Set(["source.md"]),
		);
		expect(artifacts.lookupKeyToLookupPaths.get("note.md")).toBe("Note.md");
	});

	test("deduplicates duplicate raw lookup keys within the same source", async () => {
		const { mockVault, mockMetadataCache, files } = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["target", "target", "target"] },
			{ path: "target.md" },
		]).build();

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{},
		);

		expect(
			Array.from(
				artifacts.sourceSummaries.get("source.md")?.destinations.keys() ?? [],
			),
		).toEqual(["target.md"]);
		expect(artifacts.lookupKeyToLookupPaths.get("target.md")).toBe("target.md");
		expect(artifacts.detailedMap.get("target.md")?.has("source.md")).toBe(true);
	});

	test("shares representative refs between destination and lookup key summaries", async () => {
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["target"] },
			{ path: "target.md" },
		]).build();

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{},
		);
		const summary = artifacts.sourceSummaries.get("source.md")!;

		expect(summary.orderedReferences).toHaveLength(1);
		expect(summary.destinations.get("target.md")?.firstRefIndex).toBe(0);
		expect(summary.lookupEntries.get("target.md")?.firstRefIndex).toBe(0);
		expect(artifacts.detailedMap.get("target.md")?.get("source.md")).toBe(
			summary.destinations.get("target.md"),
		);
	});

	test("does not index unresolved entries when the same lookup key is resolved", async () => {
		const { mockVault, mockMetadataCache, files } = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["Note", "note.md", "note.md"] },
			{ path: "Note.md" },
		]).build();

		(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
			(linkText: string) => {
				if (linkText === "Note") {
					return files["Note.md"];
				}
				return null;
			},
		);

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{},
		);

		expect(artifacts.lookupKeyToLookupPaths.get("note.md")).toEqual(
			new Set(["Note.md", "note.md"]),
		);
		expect(artifacts.lookupPathResolvedSourceCount.get("Note.md")).toBe(1);
	});

	test("keeps source-dependent ambiguous links resolved per source path", async () => {
		const { mockVault, mockMetadataCache, files } = new VaultEnvironmentBuilder([
			{ path: "team-a/index.md", links: ["Dashboard"] },
			{ path: "team-b/index.md", links: ["Dashboard"] },
			{ path: "team-a/Dashboard.md" },
			{ path: "team-b/Dashboard.md" },
		]).build();

		(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
			(_linkText: string, sourcePath: string) => {
				if (sourcePath.startsWith("team-a/")) {
					return files["team-a/Dashboard.md"];
				}
				if (sourcePath.startsWith("team-b/")) {
					return files["team-b/Dashboard.md"];
				}
				return null;
			},
		);

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{},
		);

		expect(
			artifacts.detailedMap.get("team-a/Dashboard.md")?.has("team-a/index.md"),
		).toBe(true);
		expect(
			artifacts.detailedMap.get("team-b/Dashboard.md")?.has("team-b/index.md"),
		).toBe(true);
	});

	test("builds tag index for markdown files without links", async () => {
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{ path: "source.md", tags: ["#tag/root", "#tag/leaf"] },
			{ path: "target.md" },
		]).build();

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{},
		);

		expect(artifacts.tagIndex.tagToFilePaths.get("tag")).toEqual(
			new Set(["source.md"]),
		);
		expect(artifacts.tagIndex.tagToFilePaths.get("tag/root")).toEqual(
			new Set(["source.md"]),
		);
		expect(artifacts.tagIndex.tagToFilePaths.get("tag/leaf")).toEqual(
			new Set(["source.md"]),
		);
		expect(artifacts.sourceSummaries.has("source.md")).toBe(false);
		expect(artifacts.detailedMap.has("source.md")).toBe(false);
	});

	test("indexes link-capable files and ignores unsupported files", async () => {
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{
				path: "source.md",
				links: ["target"],
				tags: ["#tag/root", "#tag/leaf"],
			},
			{ path: "target.md", tags: ["#target"] },
			{ path: "board.canvas", links: ["target"] },
			{ path: "asset.png", links: ["target"], tags: ["#ignored"] },
		]).build();

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{},
		);

		expect(artifacts.detailedMap.get("target.md")?.has("source.md")).toBe(true);
		expect(artifacts.detailedMap.get("target.md")?.has("board.canvas")).toBe(true);
		expect(artifacts.detailedMap.get("target.md")?.has("asset.png")).toBe(false);
		expect(artifacts.tagIndex.fileEntries.has("asset.png")).toBe(false);
		expect(artifacts.tagIndex.tagToFilePaths.get("tag/root")).toEqual(
			new Set(["source.md"]),
		);
	});

	test("can yield during large builds without changing artifacts", async () => {
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{
				path: "source.md",
				links: Array.from({ length: 256 }, (_, index) => `missing-${index}`),
			},
		]).build();
		let yieldCount = 0;

		const artifacts = await buildDetailedBacklinksArtifactsChunked(
			mockVault,
			mockMetadataCache,
			{
				yieldIntervalMs: 0,
				yieldFn: () => {
					yieldCount++;
					return Promise.resolve();
				},
			},
		);

		expect(yieldCount).toBeGreaterThan(0);
		expect(artifacts.detailedMap.size).toBe(256);
		expect(artifacts.lookupKeyToLookupPaths.size).toBe(256);
		expect(artifacts.lookupPathResolvedSourceCount.size).toBe(0);
	});

	test("aborts a stale rebuild at a yield boundary", async () => {
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{
				path: "source.md",
				links: Array.from({ length: 256 }, (_, index) => `missing-${index}`),
			},
		]).build();
		const abortController = new AbortController();

		await expect(
			buildDetailedBacklinksArtifactsChunked(mockVault, mockMetadataCache, {
				signal: abortController.signal,
				yieldIntervalMs: 0,
				yieldFn: async () => {
					abortController.abort();
				},
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	test("visitResolvedBacklinkRefsUnorderedAsync pauses traversal at yield boundaries", async () => {
		const totalLinks = 256;
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{
				path: "source.md",
				links: Array.from(
					{ length: totalLinks },
					(_, index) => `missing-${index}`,
				),
			},
		]).build();

		let resolvedReferenceCount = 0;
		let yieldResolveFn: (() => void) | null = null;
		const firstYieldPromise = new Promise<void>((resolve) => {
			yieldResolveFn = resolve;
		});

		const yieldScheduler: YieldScheduler = {
			checkpoint(iteration: number, cadence: number) {
				if (iteration === 0 || (iteration & (cadence - 1)) !== 0) {
					return undefined;
				}
				return firstYieldPromise;
			},
		};

		const sourceFile = mockVault.getFiles()[0];
		const cache = mockMetadataCache.getFileCache(sourceFile);
		const resolvedMemo = createResolvedLinkMemo();
		const ambiguityDetector = createLinkResolutionAmbiguityDetector(mockVault);

		const visitPromise = visitResolvedBacklinkRefsUnorderedAsync(
			mockMetadataCache,
			sourceFile,
			cache,
			ambiguityDetector,
			resolvedMemo,
			yieldScheduler,
			() => {
				resolvedReferenceCount++;
			},
			HEAVY_YIELD_CHECK_INTERVAL,
		);

		await Promise.resolve();
		await Promise.resolve();

		expect(resolvedReferenceCount).toBeLessThan(totalLinks);

		yieldResolveFn!();

		await visitPromise;

		expect(resolvedReferenceCount).toBe(totalLinks);
	});
});
