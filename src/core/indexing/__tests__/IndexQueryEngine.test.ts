import { describe, expect, test } from "vitest";
import { IndexQueryEngine } from "../index-service/IndexQueryEngine";
import { buildIndexSnapshotAsync } from "./snapshotTestHelpers";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import type { CachedMetadata, TFile } from "obsidian";

function createQueryEnvironment(
	definitions: Array<{ path: string; links?: string[]; tags?: string[] }>,
) {
	const env = new VaultEnvironmentBuilder(definitions).build();
	return {
		...env,
		engine: new IndexQueryEngine(env.mockVault),
		snapshotBuilder: {
			buildAsync: () =>
				buildIndexSnapshotAsync(env.mockVault, env.mockMetadataCache),
		},
	};
}

describe("IndexQueryEngine", () => {
	describe("getBacklinksForLink", () => {
		test("can retrieve backlinks for a specified path", async () => {
			const env = createQueryEnvironment([
				{ path: "file1.md", links: ["target"] },
				{ path: "file2.md", links: ["target"] },
				{ path: "target.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const backlinks = env.engine.getBacklinksForLink(snapshot, "target.md");

			expect(backlinks).toHaveLength(2);
			const sourcePaths = backlinks.map((link) => link.sourceFile.path);
			expect(sourcePaths).toContain("file1.md");
			expect(sourcePaths).toContain("file2.md");
		});

		test("unresolved links can be retrieved by aggregating case-different keys", async () => {
			const env = createQueryEnvironment([
				{ path: "A.md", links: ["Foo"] },
				{ path: "B.md", links: ["foo"] },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const backlinks = env.engine.getBacklinksForLink(snapshot, "foo.md");

			expect(backlinks).toHaveLength(2);
			const sourcePaths = backlinks.map((link) => link.sourceFile.path);
			expect(sourcePaths).toContain("A.md");
			expect(sourcePaths).toContain("B.md");
		});

		test("resolved results take priority even when resolved and unresolved conflict on the same lookupKey", async () => {
			const env = createQueryEnvironment([
				{ path: "resolved-source.md", links: ["Note"] },
				{ path: "unresolved-source.md", links: ["note.md"] },
				{ path: "Note.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const backlinks = env.engine.getBacklinksForLink(snapshot, "Note.md");

			expect(backlinks).toHaveLength(1);
			expect(backlinks[0].sourceFile.path).toBe("resolved-source.md");
		});

		test("cached backlinks reuse an immutable result", async () => {
			const env = createQueryEnvironment([
				{ path: "source.md", links: ["target"] },
				{ path: "target.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const first = env.engine.getBacklinksForLink(snapshot, "target.md");
			const second = env.engine.getBacklinksForLink(snapshot, "target.md");

			expect(Object.isFrozen(first)).toBe(true);
			expect(Object.isFrozen(first[0])).toBe(true);
			expect(second).toBe(first);
			expect(second).toHaveLength(1);
			expect(second[0].backlinkCount).toBe(1);
		});
	});

	describe("getBacklinkCountForLink", () => {
		test("can retrieve backlink count for a specified path", async () => {
			const env = createQueryEnvironment([
				{ path: "file1.md", links: ["target"] },
				{ path: "file2.md", links: ["target"] },
				{ path: "target.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const count = env.engine.getBacklinkCountForLink(snapshot, "target.md");

			expect(count).toBe(2);
		});

		test("unresolved backlink count aggregates case-different keys", async () => {
			const env = createQueryEnvironment([
				{ path: "A.md", links: ["Foo"] },
				{ path: "B.md", links: ["foo"] },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const count = env.engine.getBacklinkCountForLink(snapshot, "Foo.md");

			expect(count).toBe(2);
		});

		test("returns resolved count even when resolved and unresolved conflict on the same lookupKey", async () => {
			const env = createQueryEnvironment([
				{ path: "src-resolved.md", links: ["Note"] },
				{ path: "src-unresolved.md", links: ["note.md"] },
				{ path: "Note.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const count = env.engine.getBacklinkCountForLink(snapshot, "Note.md");

			expect(count).toBe(1);
		});
	});

	describe("hasAtLeastUniqueBacklinkSources", () => {
		test("multiple links from the same source are counted as one", async () => {
			const env = createQueryEnvironment([
				{ path: "file1.md", links: ["target", "target", "target"] },
				{ path: "file2.md", links: ["target"] },
				{ path: "target.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();

			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "target.md", 2),
			).toBe(true);
			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "target.md", 3),
			).toBe(false);
		});

		test("returns unique source count with excludePath specified", async () => {
			const env = createQueryEnvironment([
				{ path: "origin.md", links: ["target"] },
				{ path: "peer.md", links: ["target"] },
				{ path: "target.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const links = env.engine.getUniqueBacklinkSourcesForLink(
				snapshot,
				"target.md",
				"origin.md",
			);

			expect(links).toHaveLength(1);
			expect(links[0].sourceFile.path).toBe("peer.md");
		});

		test("excludes nonexistent sources when requireExistingSourceFile=true", async () => {
			const env = createQueryEnvironment([
				{ path: "file1.md", links: ["target"] },
				{ path: "file2.md", links: ["target"] },
				{ path: "file3.md", links: ["target"] },
				{ path: "target.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			env.mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === "file2.md") {
					return null;
				}
				return env.files[path] ?? null;
			});

			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "target.md", 3, {
					requireExistingSourceFile: true,
				}),
			).toBe(false);
			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "target.md", 2, {
					requireExistingSourceFile: true,
				}),
			).toBe(true);
		});

		test("excludes the source specified by excludePath from judgment", async () => {
			const env = createQueryEnvironment([
				{ path: "file1.md", links: ["target"] },
				{ path: "file2.md", links: ["target"] },
				{ path: "target.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();

			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "target.md", 2, {
					excludePath: "file1.md",
				}),
			).toBe(false);
			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "target.md", 1, {
					excludePath: "file1.md",
				}),
			).toBe(true);
		});

		test("unresolved links aggregate case-different keys for threshold judgment", async () => {
			const env = createQueryEnvironment([
				{ path: "A.md", links: ["Foo"] },
				{ path: "B.md", links: ["foo"] },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();

			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "foo.md", 2, {
					requireExistingSourceFile: true,
				}),
			).toBe(true);
			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "Foo.md", 2, {
					requireExistingSourceFile: true,
				}),
			).toBe(true);
		});

		test("uses resolved set for threshold judgment even when resolved and unresolved conflict on the same lookupKey", async () => {
			const env = createQueryEnvironment([
				{ path: "src-resolved.md", links: ["Note"] },
				{ path: "src-unresolved.md", links: ["note.md"] },
				{ path: "Note.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();

			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "Note.md", 1, {
					requireExistingSourceFile: true,
				}),
			).toBe(true);
			expect(
				env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "Note.md", 2, {
					requireExistingSourceFile: true,
				}),
			).toBe(false);
		});
	});

	describe("isUnresolvedWithSingleBacklink", () => {
		test("returns true when unresolved link has a single source", async () => {
			const env = createQueryEnvironment([{ path: "A.md", links: ["Foo"] }]);

			const snapshot = await env.snapshotBuilder.buildAsync();

			expect(env.engine.isUnresolvedWithSingleBacklink(snapshot, "foo.md")).toBe(
				true,
			);
			expect(env.engine.isUnresolvedWithSingleBacklink(snapshot, "Foo.md")).toBe(
				true,
			);
		});

		test("unresolved links aggregate case differences for single backlink determination", async () => {
			const env = createQueryEnvironment([
				{ path: "A.md", links: ["Foo"] },
				{ path: "B.md", links: ["foo"] },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();

			expect(env.engine.isUnresolvedWithSingleBacklink(snapshot, "foo.md")).toBe(
				false,
			);
			expect(env.engine.isUnresolvedWithSingleBacklink(snapshot, "Foo.md")).toBe(
				false,
			);
		});

		test("returns false when the lookup key has a directly resolved path", async () => {
			const env = createQueryEnvironment([
				{ path: "source.md", links: ["Note"] },
				{ path: "Note.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();

			expect(snapshot.lookupKeyToSources.get("note.md")).toEqual(
				new Set(["source.md"]),
			);
			expect(snapshot.lookupKeyDirectResolvedPathCount.get("note.md")).toBe(1);
			expect(env.engine.isUnresolvedWithSingleBacklink(snapshot, "Note.md")).toBe(
				false,
			);
		});

		test("updates query cache even on representative change of sibling lookupPaths", async () => {
			const env = createQueryEnvironment([{ path: "source.md" }]);

			(env.mockMetadataCache.getFileCache as any).mockImplementation(
				(file: TFile) => {
					if (file.path === "source.md") {
						return {
							links: [
								{
									link: "Foo",
									original: "[[Foo]]",
									position: {
										start: { line: 0, col: 0, offset: 10 },
										end: { line: 0, col: 0, offset: 10 },
									},
								},
								{
									link: "foo",
									original: "[[foo]]",
									position: {
										start: { line: 0, col: 0, offset: 20 },
										end: { line: 0, col: 0, offset: 20 },
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
					return null;
				},
			);

			const snapshot = await env.snapshotBuilder.buildAsync();

			expect(env.engine.getBacklinksForLink(snapshot, "Foo.md")).toMatchObject([
				{ rawText: "Foo" },
			]);
			expect(env.engine.getBacklinksForLink(snapshot, "foo.md")).toMatchObject([
				{ rawText: "Foo" },
			]);

			(env.mockMetadataCache.getFileCache as any).mockImplementation(
				(file: TFile) => {
					if (file.path === "source.md") {
						return {
							links: [
								{
									link: "foo",
									original: "[[foo]]",
									position: {
										start: { line: 0, col: 0, offset: 10 },
										end: { line: 0, col: 0, offset: 10 },
									},
								},
								{
									link: "Foo",
									original: "[[Foo]]",
									position: {
										start: { line: 0, col: 0, offset: 20 },
										end: { line: 0, col: 0, offset: 20 },
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
					return null;
				},
			);

			const snapshot2 = await env.snapshotBuilder.buildAsync();

			expect(env.engine.getBacklinksForLink(snapshot2, "Foo.md")).toMatchObject([
				{ rawText: "foo" },
			]);
			expect(env.engine.getBacklinksForLink(snapshot2, "foo.md")).toMatchObject([
				{ rawText: "foo" },
			]);
		});
	});

	describe("miscellaneous", () => {
		test("caps at limit when specified", async () => {
			const env = createQueryEnvironment([
				{ path: "source-a.md", links: ["target"] },
				{ path: "source-b.md", links: ["target"] },
				{ path: "source-c.md", links: ["target"] },
				{ path: "target.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const callsBefore = env.mockVault.getAbstractFileByPath.mock.calls.length;
			const links = env.engine.getUniqueBacklinkSourcesForLink(
				snapshot,
				"target.md",
				undefined,
				2,
			);

			expect(links).toHaveLength(2);
			expect(
				env.mockVault.getAbstractFileByPath.mock.calls.length - callsBefore,
			).toBe(2);
		});

		test("cached unique backlinks reuse an immutable result", async () => {
			const env = createQueryEnvironment([
				{ path: "source.md", links: ["target"] },
				{ path: "target.md" },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const first = env.engine.getUniqueBacklinkSourcesForLink(
				snapshot,
				"target.md",
			);
			const second = env.engine.getUniqueBacklinkSourcesForLink(
				snapshot,
				"target.md",
			);

			expect(Object.isFrozen(first)).toBe(true);
			expect(Object.isFrozen(first[0])).toBe(true);
			expect(second).toBe(first);
			expect(second).toHaveLength(1);
			expect(second[0].backlinkCount).toBe(1);
		});

		test("restores representative backlink from sourceSummary", async () => {
			const env = createQueryEnvironment([
				{ path: "source.md" },
				{ path: "target.md" },
			]);
			(env.mockMetadataCache.getFileCache as any).mockImplementation(
				(file: TFile) => {
					if (file.path === "source.md") {
						return {
							links: [
								{
									link: "target",
									original: "[[target|late]]",
									displayText: "late",
									position: {
										start: { line: 0, col: 0, offset: 120 },
										end: { line: 0, col: 12, offset: 132 },
									},
								},
								{
									link: "target",
									original: "[[target|early]]",
									displayText: "early",
									position: {
										start: { line: 0, col: 0, offset: 10 },
										end: { line: 0, col: 13, offset: 23 },
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
				},
			);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const backlinks = env.engine.getBacklinksForLink(snapshot, "target.md");

			expect(backlinks).toHaveLength(1);
			expect(backlinks[0]).toMatchObject({
				displayText: "early",
				backlinkCount: 2,
				position: undefined,
			});
		});

		test("restores representative backlink by lookupKey even for unresolved merged lookups", async () => {
			const env = createQueryEnvironment([
				{ path: "source.md", links: ["Foo", "foo"] },
			]);

			const snapshot = await env.snapshotBuilder.buildAsync();
			const backlinks = env.engine.getBacklinksForLink(snapshot, "foo.md");

			expect(backlinks).toHaveLength(1);
			expect(backlinks[0]).toMatchObject({
				rawText: "Foo",
				isUnresolved: true,
				backlinkCount: 2,
				position: undefined,
			});
		});
	});
});
