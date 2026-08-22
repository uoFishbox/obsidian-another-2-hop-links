import { describe, expect, test } from "vitest";
import { IncrementalIndexUpdater } from "../index-service/IncrementalIndexUpdater";
import {
	collectSourcePathsForLookupKeys,
	hasDirectResolvedLookupKey,
} from "../backlink-builder/lookupGraphQueries";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import { buildIndexSnapshotAsync, serializeSnapshot } from "./snapshotTestHelpers";
import type { CachedMetadata, TFile } from "obsidian";
import type { IndexSnapshot, SourceSummary } from "../types/IndexTypes";

function getUnresolvedLookupKeys(summary: SourceSummary | undefined): Set<string> {
	return new Set(
		Array.from(summary?.lookupEntries.entries() ?? [])
			.filter(([, entry]) => entry.isUnresolved)
			.map(([lookupKey]) => lookupKey),
	);
}

function createPosition(offset: number) {
	return {
		start: { line: 0, col: 0, offset },
		end: { line: 0, col: 5, offset: offset + 5 },
	};
}

function createCachedMetadata(
	links: Array<{
		link: string;
		displayText?: string;
		offset: number;
	}>,
): CachedMetadata {
	return {
		links: links.map((link) => ({
			link: link.link,
			original: link.displayText
				? `[[${link.link}|${link.displayText}]]`
				: `[[${link.link}]]`,
			displayText: link.displayText,
			position: createPosition(link.offset),
		})),
		embeds: [],
		headings: [],
		sections: [],
		tags: [],
		frontmatter: undefined,
		frontmatterPosition: undefined,
		frontmatterLinks: undefined,
	} as CachedMetadata;
}

function createUpdaterEnvironment(
	definitions: Array<{ path: string; links?: string[]; tags?: string[] }>,
) {
	const env = new VaultEnvironmentBuilder(definitions).build();
	return {
		...env,
		snapshotBuilder: {
			buildAsync: () =>
				buildIndexSnapshotAsync(env.mockVault, env.mockMetadataCache),
		},
		updater: new IncrementalIndexUpdater(env.mockVault, env.mockMetadataCache),
	};
}

describe("IncrementalIndexUpdater", () => {
	test("equivalent incremental mutation produces the same snapshot as full rebuild", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "origin.md", links: ["target"] },
			{ path: "target.md" },
		]);
		const final = createUpdaterEnvironment([
			{ path: "origin.md", links: ["target", "extra"] },
			{ path: "target.md" },
			{ path: "extra.md" },
		]);

		initial.builder.addFile({
			path: "origin.md",
			links: ["target", "extra"],
		});
		initial.builder.addFile({ path: "extra.md" });

		const snapshot = await initial.snapshotBuilder.buildAsync();
		await initial.updater.applyAsync(snapshot, [
			{ type: "modify", path: "origin.md" },
			{ type: "create", path: "extra.md" },
		]);

		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("delete removes source from link targets and returns affected lookup paths", async () => {
		const env = createUpdaterEnvironment([
			{ path: "origin.md", links: ["first", "second"] },
			{ path: "first.md" },
			{ path: "second.md" },
		]);

		const snapshot = await env.snapshotBuilder.buildAsync();
		const result = await env.updater.applyAsync(snapshot, [
			{ type: "delete", path: "origin.md" },
		]);

		expect(snapshot.backlinksMap.get("first.md")).toBeUndefined();
		expect(snapshot.backlinksMap.get("second.md")).toBeUndefined();
		expect(result.affectedLookupPaths).toEqual(
			new Set(["origin.md", "first.md", "second.md"]),
		);
	});

	test("create shadowing moves backlinks to the new resolution target", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "src/origin.md", links: ["note"] },
			{ path: "archive/note.md" },
		]);
		const final = createUpdaterEnvironment([
			{ path: "src/origin.md", links: ["note"] },
			{ path: "archive/note.md" },
			{ path: "src/note.md" },
		]);

		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.addFile({ path: "src/note.md" });
		installShadowingResolver(initial.mockVault, initial.mockMetadataCache);
		installShadowingResolver(final.mockVault, final.mockMetadataCache);

		await initial.updater.applyAsync(snapshot, [
			{ type: "create", path: "src/note.md" },
		]);

		expect(snapshot.backlinksMap.get("src/note.md")?.has("src/origin.md")).toBe(
			true,
		);
		expect(snapshot.backlinksMap.get("archive/note.md")).toBeUndefined();
		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("create unresolved materialize reprocesses sources", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "origin.md", links: ["missing"] },
		]);
		const final = createUpdaterEnvironment([
			{ path: "origin.md", links: ["missing"] },
			{ path: "missing.md" },
		]);

		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.addFile({ path: "missing.md" });

		await initial.updater.applyAsync(snapshot, [
			{ type: "create", path: "missing.md" },
		]);

		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("create reflects both unresolved fast path and shadowing fallback without duplicates", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "src/origin.md", links: ["note"] },
			{ path: "other/unresolved-source.md", links: ["src/note"] },
			{ path: "archive/note.md" },
		]);
		const final = createUpdaterEnvironment([
			{ path: "src/origin.md", links: ["note"] },
			{ path: "other/unresolved-source.md", links: ["src/note"] },
			{ path: "archive/note.md" },
			{ path: "src/note.md" },
		]);

		installShadowingResolver(initial.mockVault, initial.mockMetadataCache);
		installShadowingResolver(final.mockVault, final.mockMetadataCache);
		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.addFile({ path: "src/note.md" });
		installShadowingResolver(initial.mockVault, initial.mockMetadataCache);

		const result = await initial.updater.applyAsync(snapshot, [
			{ type: "create", path: "src/note.md" },
		]);

		expect(result.affectedPaths).toEqual(
			new Set(["src/note.md", "src/origin.md", "other/unresolved-source.md"]),
		);
		expect(snapshot.backlinksMap.get("src/note.md")?.has("src/origin.md")).toBe(
			true,
		);
		expect(
			snapshot.backlinksMap.get("src/note.md")?.has("other/unresolved-source.md"),
		).toBe(true);
		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("basename-preserving rename/move transfers backlinks to the new path and snapshot matches full rebuild", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "src/origin.md", links: ["note"] },
			{ path: "folderA/note.md" },
		]);
		const final = createUpdaterEnvironment([
			{ path: "src/origin.md", links: ["note"] },
			{ path: "src/note.md" },
		]);

		installMovedNoteResolver(initial.mockVault, initial.mockMetadataCache);
		installMovedNoteResolver(final.mockVault, final.mockMetadataCache);

		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.removeFile("folderA/note.md");
		initial.builder.addFile({ path: "src/note.md" });
		installMovedNoteResolver(initial.mockVault, initial.mockMetadataCache);

		const result = await initial.updater.applyAsync(snapshot, [
			{
				type: "rename",
				oldPath: "folderA/note.md",
				newPath: "src/note.md",
			},
		]);

		expect(result.affectedPaths).toEqual(
			new Set(["folderA/note.md", "src/note.md", "src/origin.md"]),
		);
		expect(snapshot.backlinksMap.get("src/note.md")?.has("src/origin.md")).toBe(
			true,
		);
		expect(snapshot.backlinksMap.get("folderA/note.md")).toBeUndefined();
		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("rename target file itself is re-parsed to reflect sourcePath-dependent relative link resolution", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "folderA/note.md", links: ["./peer"] },
			{ path: "folderA/peer.md" },
			{ path: "src/peer.md" },
		]);
		const final = createUpdaterEnvironment([
			{ path: "src/note.md", links: ["./peer"] },
			{ path: "folderA/peer.md" },
			{ path: "src/peer.md" },
		]);

		installRelativeRenameResolver(initial.mockVault, initial.mockMetadataCache);
		installRelativeRenameResolver(final.mockVault, final.mockMetadataCache);

		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.removeFile("folderA/note.md");
		initial.builder.addFile({ path: "src/note.md", links: ["./peer"] });
		installRelativeRenameResolver(initial.mockVault, initial.mockMetadataCache);

		const result = await initial.updater.applyAsync(snapshot, [
			{
				type: "rename",
				oldPath: "folderA/note.md",
				newPath: "src/note.md",
			},
		]);

		expect(result.affectedPaths).toEqual(
			new Set(["folderA/note.md", "src/note.md"]),
		);
		expect(snapshot.backlinksMap.get("folderA/peer.md")).toBeUndefined();
		expect(snapshot.backlinksMap.get("src/peer.md")?.has("src/note.md")).toBe(true);
		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("rename target file with backslash relative link is re-parsed instead of using the fast path", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "folderA/note.md", links: [".\\peer"] },
			{ path: "folderA/peer.md" },
			{ path: "src/peer.md" },
		]);
		const final = createUpdaterEnvironment([
			{ path: "src/note.md", links: [".\\peer"] },
			{ path: "folderA/peer.md" },
			{ path: "src/peer.md" },
		]);

		installRelativeRenameResolver(initial.mockVault, initial.mockMetadataCache);
		installRelativeRenameResolver(final.mockVault, final.mockMetadataCache);

		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.removeFile("folderA/note.md");
		initial.builder.addFile({ path: "src/note.md", links: [".\\peer"] });
		installRelativeRenameResolver(initial.mockVault, initial.mockMetadataCache);

		await initial.updater.applyAsync(snapshot, [
			{
				type: "rename",
				oldPath: "folderA/note.md",
				newPath: "src/note.md",
			},
		]);

		expect(snapshot.backlinksMap.get("folderA/peer.md")).toBeUndefined();
		expect(snapshot.backlinksMap.get("src/peer.md")?.has("src/note.md")).toBe(true);
		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("basename-changing rename reverts old-name sources to unresolved and moves new-name candidate sources to the new path", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "old-source.md", links: ["old-name"] },
			{ path: "unresolved-source.md", links: ["new-name"] },
			{ path: "shadow-source.md", links: ["new-name"] },
			{ path: "old-name.md" },
			{ path: "archive/new-name.md" },
		]);
		const final = createUpdaterEnvironment([
			{ path: "old-source.md", links: ["old-name"] },
			{ path: "unresolved-source.md", links: ["new-name"] },
			{ path: "shadow-source.md", links: ["new-name"] },
			{ path: "src/new-name.md" },
			{ path: "archive/new-name.md" },
		]);

		installRenamedNoteResolver(initial.mockVault, initial.mockMetadataCache);
		installRenamedNoteResolver(final.mockVault, final.mockMetadataCache);

		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.removeFile("old-name.md");
		initial.builder.addFile({ path: "src/new-name.md" });
		installRenamedNoteResolver(initial.mockVault, initial.mockMetadataCache);

		const result = await initial.updater.applyAsync(snapshot, [
			{
				type: "rename",
				oldPath: "old-name.md",
				newPath: "src/new-name.md",
			},
		]);

		expect(result.affectedPaths).toEqual(
			new Set([
				"old-name.md",
				"src/new-name.md",
				"old-source.md",
				"unresolved-source.md",
				"shadow-source.md",
			]),
		);
		expect(
			snapshot.backlinksMap.get("src/new-name.md")?.has("unresolved-source.md"),
		).toBe(true);
		expect(
			snapshot.backlinksMap.get("src/new-name.md")?.has("shadow-source.md"),
		).toBe(true);
		expect(snapshot.backlinksMap.get("archive/new-name.md")).toBeUndefined();
		expect(
			getUnresolvedLookupKeys(snapshot.sourceSummaries.get("old-source.md")),
		).toEqual(new Set(["old-name.md"]));
		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("basename-preserving rename also re-parses self file referencing oldPath explicitly and marks it unresolved", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "folderA/note.md", links: ["folderA/note"] },
		]);
		const final = createUpdaterEnvironment([
			{ path: "src/note.md", links: ["folderA/note"] },
		]);

		installOldPathReferenceResolver(initial.mockVault, initial.mockMetadataCache);
		installOldPathReferenceResolver(final.mockVault, final.mockMetadataCache);

		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.removeFile("folderA/note.md");
		initial.builder.addFile({
			path: "src/note.md",
			links: ["folderA/note"],
		});
		installOldPathReferenceResolver(initial.mockVault, initial.mockMetadataCache);

		const result = await initial.updater.applyAsync(snapshot, [
			{
				type: "rename",
				oldPath: "folderA/note.md",
				newPath: "src/note.md",
			},
		]);

		expect(result.affectedPaths).toEqual(
			new Set(["folderA/note.md", "src/note.md"]),
		);
		expect(snapshot.backlinksMap.get("src/note.md")).toBeUndefined();
		expect(
			getUnresolvedLookupKeys(snapshot.sourceSummaries.get("src/note.md")),
		).toEqual(new Set(["foldera/note.md"]));

		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("basename-preserving rename also re-parses self file that had unresolved references to newPath and marks it resolved", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "folderA/note.md", links: ["src/note"] },
		]);
		const final = createUpdaterEnvironment([
			{ path: "src/note.md", links: ["src/note"] },
		]);

		installNewPathReferenceResolver(initial.mockVault, initial.mockMetadataCache);
		installNewPathReferenceResolver(final.mockVault, final.mockMetadataCache);

		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.removeFile("folderA/note.md");
		initial.builder.addFile({ path: "src/note.md", links: ["src/note"] });
		installNewPathReferenceResolver(initial.mockVault, initial.mockMetadataCache);

		const result = await initial.updater.applyAsync(snapshot, [
			{
				type: "rename",
				oldPath: "folderA/note.md",
				newPath: "src/note.md",
			},
		]);

		expect(result.affectedPaths).toEqual(
			new Set(["folderA/note.md", "src/note.md"]),
		);
		expect(snapshot.backlinksMap.get("src/note.md")?.has("src/note.md")).toBe(true);
		expect(
			snapshot.sourceSummaries
				.get("src/note.md")
				?.lookupEntries.get("src/note.md")?.isUnresolved === true,
		).toBe(false);

		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("same source across sibling lookupPaths can recompute lookupKey set and restore unresolved status", async () => {
		const initial = createUpdaterEnvironment([
			{ path: "origin.md", links: ["Foo", "foo"] },
		]);
		const final = createUpdaterEnvironment([
			{ path: "origin.md", links: ["Foo", "foo"] },
			{ path: "foo.md" },
		]);

		const snapshot = await initial.snapshotBuilder.buildAsync();
		initial.builder.addFile({ path: "foo.md" });

		await initial.updater.applyAsync(snapshot, [
			{ type: "create", path: "foo.md" },
		]);

		expect(serializeSnapshot(snapshot)).toEqual(
			serializeSnapshot(await final.snapshotBuilder.buildAsync()),
		);
	});

	test("alias-only modify does not mark the link index as changed", async () => {
		const env = createUpdaterEnvironment([
			{ path: "source.md" },
			{ path: "target.md" },
		]);

		(env.mockMetadataCache.getFileCache as any).mockImplementation(
			(file: TFile) => {
				if (file.path === "source.md") {
					return createCachedMetadata([
						{ link: "target", displayText: "AAA", offset: 0 },
					]);
				}
				return null;
			},
		);

		const snapshot = await env.snapshotBuilder.buildAsync();

		(env.mockMetadataCache.getFileCache as any).mockImplementation(
			(file: TFile) => {
				if (file.path === "source.md") {
					return createCachedMetadata([
						{ link: "target", displayText: "BBB", offset: 0 },
					]);
				}
				return null;
			},
		);

		const result = await env.updater.applyAsync(snapshot, [
			{ type: "modify", path: "source.md" },
		]);

		expect(result.affectedPaths).toEqual(new Set(["source.md"]));
		expect(result.affectedLookupPaths).toEqual(new Set());
		expect(result.affectedLookupKeys).toEqual(new Set());
		expect(result.affectedLinkSourcePaths).toEqual(new Set());
		expect(result.linkIndexChanged).toBe(false);
		expect([...result.cacheInvalidationPaths]).toEqual([]);
	});

	test("modify returns cache invalidation on representative change across sibling lookupPaths", async () => {
		const env = createUpdaterEnvironment([{ path: "source.md" }]);

		(env.mockMetadataCache.getFileCache as any).mockImplementation(
			(file: TFile) => {
				if (file.path === "source.md") {
					return createCachedMetadata([
						{ link: "Foo", offset: 10 },
						{ link: "foo", offset: 20 },
					]);
				}
				return null;
			},
		);

		const snapshot = await env.snapshotBuilder.buildAsync();

		(env.mockMetadataCache.getFileCache as any).mockImplementation(
			(file: TFile) => {
				if (file.path === "source.md") {
					return createCachedMetadata([
						{ link: "foo", offset: 10 },
						{ link: "Foo", offset: 20 },
					]);
				}
				return null;
			},
		);

		const result = await env.updater.applyAsync(snapshot, [
			{ type: "modify", path: "source.md" },
		]);

		expect(result.affectedLookupKeys).toEqual(new Set(["foo.md"]));
		expect([...result.cacheInvalidationPaths].sort()).toEqual(["Foo.md", "foo.md"]);
	});

	test("modify updates unresolved source summary to resolved state", async () => {
		const env = createUpdaterEnvironment([
			{ path: "origin.md", links: ["missing"] },
			{ path: "target.md" },
		]);
		const snapshot = await env.snapshotBuilder.buildAsync();

		expect(
			getUnresolvedLookupKeys(snapshot.sourceSummaries.get("origin.md")),
		).toEqual(new Set(["missing.md"]));
		env.builder.addFile({ path: "origin.md", links: ["target"] });
		await env.updater.applyAsync(snapshot, [{ type: "modify", path: "origin.md" }]);

		expect(
			getUnresolvedLookupKeys(snapshot.sourceSummaries.get("origin.md")).size,
		).toBe(0);
	});

	test("delete removes an unresolved source summary", async () => {
		const env = createUpdaterEnvironment([
			{ path: "origin.md", links: ["missing"] },
		]);
		const snapshot = await env.snapshotBuilder.buildAsync();

		expect(
			getUnresolvedLookupKeys(snapshot.sourceSummaries.get("origin.md")),
		).toEqual(new Set(["missing.md"]));

		const result = await env.updater.applyAsync(snapshot, [
			{ type: "delete", path: "origin.md" },
		]);

		expect(result.affectedLookupPaths).toEqual(
			new Set(["origin.md", "missing.md"]),
		);
		expect(snapshot.sourceSummaries.has("origin.md")).toBe(false);
	});
});

function installShadowingResolver(mockVault: any, mockMetadataCache: any): void {
	(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
		(linkText: string, sourcePath: string) => {
			if (sourcePath === "src/origin.md" && linkText === "note") {
				return (
					mockVault.getAbstractFileByPath("src/note.md") ??
					mockVault.getAbstractFileByPath("archive/note.md")
				);
			}

			const normalized = linkText.endsWith(".md") ? linkText : `${linkText}.md`;
			return mockVault.getAbstractFileByPath(normalized);
		},
	);
}

function installMovedNoteResolver(mockVault: any, mockMetadataCache: any): void {
	(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
		(linkText: string, sourcePath: string) => {
			if (sourcePath === "src/origin.md" && linkText === "note") {
				return (
					mockVault.getAbstractFileByPath("src/note.md") ??
					mockVault.getAbstractFileByPath("folderA/note.md")
				);
			}

			const normalized = linkText.endsWith(".md") ? linkText : `${linkText}.md`;
			return mockVault.getAbstractFileByPath(normalized);
		},
	);
}

function installRelativeRenameResolver(mockVault: any, mockMetadataCache: any): void {
	(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
		(linkText: string, sourcePath: string) => {
			if (linkText === "./peer" || linkText === ".\\peer") {
				if (sourcePath === "folderA/note.md") {
					return mockVault.getAbstractFileByPath("folderA/peer.md");
				}
				if (sourcePath === "src/note.md") {
					return mockVault.getAbstractFileByPath("src/peer.md");
				}
			}

			const normalized = linkText.endsWith(".md") ? linkText : `${linkText}.md`;
			return mockVault.getAbstractFileByPath(normalized);
		},
	);
}

function installRenamedNoteResolver(mockVault: any, mockMetadataCache: any): void {
	(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
		(linkText: string, sourcePath: string) => {
			if (linkText === "new-name") {
				if (sourcePath === "unresolved-source.md") {
					return mockVault.getAbstractFileByPath("src/new-name.md");
				}
				if (sourcePath === "shadow-source.md") {
					return (
						mockVault.getAbstractFileByPath("src/new-name.md") ??
						mockVault.getAbstractFileByPath("archive/new-name.md")
					);
				}
			}

			const normalized = linkText.endsWith(".md") ? linkText : `${linkText}.md`;
			return mockVault.getAbstractFileByPath(normalized);
		},
	);
}

function installOldPathReferenceResolver(mockVault: any, mockMetadataCache: any): void {
	(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
		(linkText: string, sourcePath: string) => {
			if (linkText === "folderA/note") {
				return mockVault.getAbstractFileByPath("folderA/note.md");
			}

			const normalized = linkText.endsWith(".md") ? linkText : `${linkText}.md`;
			return mockVault.getAbstractFileByPath(normalized);
		},
	);
}

function installNewPathReferenceResolver(mockVault: any, mockMetadataCache: any): void {
	(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
		(linkText: string, sourcePath: string) => {
			if (linkText === "src/note") {
				return mockVault.getAbstractFileByPath("src/note.md");
			}

			const normalized = linkText.endsWith(".md") ? linkText : `${linkText}.md`;
			return mockVault.getAbstractFileByPath(normalized);
		},
	);
}

describe("IncrementalIndexUpdater - unresolved link correctness", () => {
	test("incremental update can transition from single source to multiple sources and back to single source", async () => {
		const env = createUpdaterEnvironment([
			{ path: "A.md", links: ["Foo"] },
			{ path: "B.md", links: [] },
		]);
		const { snapshotBuilder, updater, mockMetadataCache } = env;

		const snapshot = await snapshotBuilder.buildAsync();
		expect(checkUnresolvedSingle(snapshot, "foo.md")).toBe(true);

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "B.md") {
				return createCachedMetadata([{ link: "foo", offset: 0 }]);
			}
			return null;
		});
		await updater.applyAsync(snapshot, [{ type: "modify", path: "B.md" }]);
		expect(checkUnresolvedSingle(snapshot, "foo.md")).toBe(false);
		expect(checkUnresolvedSingle(snapshot, "Foo.md")).toBe(false);

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "B.md") {
				return createCachedMetadata([]);
			}
			return null;
		});
		await updater.applyAsync(snapshot, [{ type: "modify", path: "B.md" }]);
		expect(checkUnresolvedSingle(snapshot, "foo.md")).toBe(true);
		expect(checkUnresolvedSingle(snapshot, "Foo.md")).toBe(true);
	});

	test("unaffected key determination results do not change with incremental updates", async () => {
		const env = createUpdaterEnvironment([
			{ path: "A.md", links: ["Foo"] },
			{ path: "C.md", links: ["Bar"] },
			{ path: "D.md", links: [] },
			{ path: "target.md" },
		]);
		const { snapshotBuilder, updater, mockMetadataCache } = env;

		const snapshot = await snapshotBuilder.buildAsync();
		expect(checkUnresolvedSingle(snapshot, "foo.md")).toBe(true);
		expect(checkUnresolvedSingle(snapshot, "bar.md")).toBe(true);

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "D.md") {
				return createCachedMetadata([{ link: "target", offset: 0 }]);
			}
			return null;
		});
		await updater.applyAsync(snapshot, [{ type: "modify", path: "D.md" }]);

		expect(checkUnresolvedSingle(snapshot, "foo.md")).toBe(true);
		expect(checkUnresolvedSingle(snapshot, "bar.md")).toBe(true);
	});

	test("after incremental update, unresolved links with case differences can still be merged and retrieved", async () => {
		const { IndexQueryEngine } = await import("../index-service/IndexQueryEngine");
		const env = createUpdaterEnvironment([
			{ path: "A.md", links: ["Foo"] },
			{ path: "B.md", links: [] },
		]);
		const { snapshotBuilder, updater, mockMetadataCache, mockVault } = env;

		const snapshot = await snapshotBuilder.buildAsync();

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "B.md") {
				return createCachedMetadata([{ link: "foo", offset: 0 }]);
			}
			return null;
		});
		await updater.applyAsync(snapshot, [{ type: "modify", path: "B.md" }]);

		const merged = new IndexQueryEngine(mockVault).getBacklinksForLink(
			snapshot,
			"Foo.md",
		);
		const sources = merged.map((b) => b.sourceFile.path);

		expect(sources).toContain("A.md");
		expect(sources).toContain("B.md");
		expect(sources.length).toBe(2);
	});
});

function checkUnresolvedSingle(snapshot: IndexSnapshot, lookupPath: string): boolean {
	const key = lookupPath.toLowerCase().replace(/\\/g, "/");
	if (hasDirectResolvedLookupKey(snapshot, key)) {
		return false;
	}
	return collectSourcePathsForLookupKeys(snapshot, [key]).size === 1;
}
