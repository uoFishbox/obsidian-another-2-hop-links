import { describe, test, expect, vi } from "vitest";
import type { IncrementalFileChange } from "../types/IndexTypes";
import type { CachedMetadata } from "../../../types/obsidian";
import { TFile, type LinkCache } from "obsidian";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";

function createLinkCache(
	linkText: string,
	displayText?: string,
	offset = 0,
): LinkCache {
	return {
		link: linkText,
		original: displayText ? `[[${linkText}|${displayText}]]` : `[[${linkText}]]`,
		displayText,
		position: {
			start: { line: 0, col: 0, offset },
			end: { line: 0, col: 0, offset },
		},
	};
}

function createCachedMetadata(
	links?: LinkCache[],
	tags?: Array<{ tag: string; position: any }>,
): CachedMetadata {
	return {
		links: links || [],
		tags: tags || [],
		embeds: [],
		headings: [],
		sections: [],
		frontmatter: undefined,
		frontmatterPosition: undefined,
		frontmatterLinks: undefined,
	} as CachedMetadata;
}

describe("IndexingService", () => {
	describe("rebuildBacklinksMap", () => {
		test("can build backlinks map in initial state", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "note1.md", links: ["note2", "note3"] },
				{ path: "note2.md", links: ["note3"] },
				{ path: "note3.md" },
			]).build();

			await service.rebuildIndexesTimeSliced();

			const backlinksMap = service.getBacklinksMap();
			expect(backlinksMap.get("note2.md")?.has("note1.md")).toBe(true);
			expect(backlinksMap.get("note3.md")?.has("note1.md")).toBe(true);
			expect(backlinksMap.get("note3.md")?.has("note2.md")).toBe(true);
			expect(backlinksMap.get("note3.md")?.size).toBe(2);
		});

		test("can retrieve source paths for a lookupKey", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "note1.md", links: ["note3"] },
				{ path: "note2.md", links: ["note3"] },
				{ path: "note3.md" },
			]).build();

			await service.rebuildIndexesTimeSliced();

			const sourcePaths = service.getSourcePathsForLookupKeys(["note3.md"]);

			expect(Array.from(sourcePaths).sort()).toEqual(["note1.md", "note2.md"]);
		});
	});

	describe("applyFileChanges - orchestration and service layer responsibilities", () => {
		test("applyFileChanges calls onDataUpdate listener", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md", links: ["file2"] },
				{ path: "file2.md" },
			]).build();

			await service.rebuildIndexesTimeSliced();

			const listener = vi.fn();
			service.onDataUpdate(listener);

			const changes: IncrementalFileChange[] = [
				{ type: "modify", path: "file1.md" },
			];

			await service.applyFileChangesTimeSliced(changes);

			expect(listener).toHaveBeenCalledTimes(1);
		});

		test("onDataUpdate is called only once even with multiple change events", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md" },
				{ path: "file2.md" },
			]).build();

			await service.rebuildIndexesTimeSliced();

			const listener = vi.fn();
			service.onDataUpdate(listener);

			const changes: IncrementalFileChange[] = [
				{ type: "modify", path: "file1.md" },
				{ type: "modify", path: "file2.md" },
			];

			await service.applyFileChangesTimeSliced(changes);

			expect(listener).toHaveBeenCalledTimes(1);
		});

		test("onDataUpdate is not called when applyFileChanges receives an empty change list", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md" },
			]).build();

			await service.rebuildIndexesTimeSliced();

			const listener = vi.fn();
			service.onDataUpdate(listener);

			const changes: IncrementalFileChange[] = [];

			await service.applyFileChangesTimeSliced(changes);

			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe("rebuildBacklinksMap and onDataUpdate", () => {
		test("onDataUpdate listener is called after rebuildBacklinksMap executes", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md", links: ["file2"] },
				{ path: "file2.md" },
			]).build();

			const listener = vi.fn();
			service.onDataUpdate(listener);

			await service.rebuildIndexesTimeSliced();

			expect(listener).toHaveBeenCalledTimes(1);
		});

		test("multiple rebuildBacklinksMap calls trigger multiple notifications", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md" },
			]).build();

			const listener = vi.fn();
			service.onDataUpdate(listener);

			await service.rebuildIndexesTimeSliced();
			await service.rebuildIndexesTimeSliced();

			expect(listener).toHaveBeenCalledTimes(2);
		});
	});

	describe("tag index-backed queries", () => {
		test("can retrieve tagged notes using tag index seeded by full rebuild", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md", tags: ["#tag1"] },
				{ path: "file2.md", tags: ["#tag1/sub"] },
			]).build();

			await service.rebuildIndexesTimeSliced();

			const notes = await service.getNotesWithTag("tag1");

			expect(notes.map((note) => note.path).sort()).toEqual([
				"file1.md",
				"file2.md",
			]);
		});

		test("peekNotesWithTag synchronously returns the current tag snapshot", async () => {
			const env = new VaultEnvironmentBuilder([
				{ path: "file1.md", tags: ["#tag1"] },
			]).build();

			await env.service.rebuildIndexesTimeSliced();

			expect(
				env.service.peekNotesWithTag("tag1").map((note) => note.path),
			).toEqual(["file1.md"]);

			env.builder.addFile({ path: "file2.md", tags: ["#tag1"] });
			await env.service.applyFileChangesTimeSliced([
				{ type: "create", path: "file2.md" },
			]);

			expect(
				env.service.peekNotesWithTag("tag1").map((note) => note.path),
			).toEqual(["file1.md", "file2.md"]);
		});

		test("tag index seeded by full rebuild is reused by incremental updates", async () => {
			const env = new VaultEnvironmentBuilder([
				{ path: "file1.md", tags: ["#tag1"] },
			]).build();

			await env.service.rebuildIndexesTimeSliced();
			expect(
				(await env.service.getNotesWithTag("tag1")).map((note) => note.path),
			).toEqual(["file1.md"]);

			env.builder.addFile({ path: "file1.md", tags: ["#tag2/sub"] });

			await env.service.applyFileChangesTimeSliced([
				{ type: "modify", path: "file1.md" },
			]);

			expect(await env.service.getNotesWithTag("tag1")).toEqual([]);
			expect(
				(await env.service.getNotesWithTag("tag2")).map((note) => note.path),
			).toEqual(["file1.md"]);
			expect(
				(await env.service.getNotesWithTag("tag2/sub")).map(
					(note) => note.path,
				),
			).toEqual(["file1.md"]);
		});

		test("tag index tracks file rename without rebuild", async () => {
			const env = new VaultEnvironmentBuilder([
				{ path: "notes/old-name.md", tags: ["#tag1"] },
			]).build();

			await env.service.rebuildIndexesTimeSliced();
			expect(
				(await env.service.getNotesWithTag("tag1")).map((note) => note.path),
			).toEqual(["notes/old-name.md"]);

			env.builder.removeFile("notes/old-name.md");
			env.builder.addFile({ path: "notes/new-name.md", tags: ["#tag1"] });

			await env.service.applyFileChangesTimeSliced([
				{
					type: "rename",
					oldPath: "notes/old-name.md",
					newPath: "notes/new-name.md",
				},
			]);

			expect(
				(await env.service.getNotesWithTag("tag1")).map((note) => note.path),
			).toEqual(["notes/new-name.md"]);
		});
	});

	describe("awaitIdle", () => {
		test("awaitIdle waits until completion when external queue waiters are registered", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md" },
			]).build();

			let releaseQueueIdle: (() => void) | undefined;
			let isQueueIdle = false;

			service.registerIdleWaiter(async () => {
				if (isQueueIdle) {
					return;
				}
				await new Promise<void>((resolve) => {
					releaseQueueIdle = () => {
						isQueueIdle = true;
						resolve();
					};
				});
			});

			let completed = false;
			const idlePromise = service.awaitIdle().then(() => {
				completed = true;
			});
			await Promise.resolve();

			expect(completed).toBe(false);

			releaseQueueIdle?.();
			await idlePromise;
			expect(completed).toBe(true);
		});

		test("awaitIdle checks external queues again after they trigger writer activity", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md" },
			]).build();
			let waiterCalls = 0;

			service.registerIdleWaiter(async () => {
				waiterCalls++;
				if (waiterCalls !== 1) {
					return;
				}
				await service.applyFileChangesTimeSliced([
					{ type: "modify", path: "file1.md" },
				]);
			});

			await service.awaitIdle();

			expect(waiterCalls).toBe(2);
		});
	});

	describe("onDataUpdate", () => {
		test("listener is called on data update", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md" },
			]).build();

			const listener = vi.fn();
			service.onDataUpdate(listener);

			await service.rebuildIndexesTimeSliced();

			expect(listener).toHaveBeenCalled();
		});

		test("listener is not called after unsubscribing", async () => {
			const { service } = new VaultEnvironmentBuilder([
				{ path: "file1.md" },
			]).build();

			const listener = vi.fn();
			const unsubscribe = service.onDataUpdate(listener);

			unsubscribe();

			await service.rebuildIndexesTimeSliced();

			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe("Integration with applyFileChanges", () => {
		test("modify: adding a link should update backlinksMap", async () => {
			const builder = new VaultEnvironmentBuilder([
				{ path: "file1.md", links: [] },
				{ path: "file2.md" },
			]);
			const { service, mockMetadataCache } = builder.build();
			await service.rebuildIndexesTimeSliced();

			let backlinks = service.getBacklinksForLink("file2.md");
			expect(backlinks.some((b) => b.sourceFile.path === "file1.md")).toBe(false);

			(mockMetadataCache.getFileCache as any).mockImplementation(
				(file: TFile) => {
					if (file.path === "file1.md") {
						return createCachedMetadata([createLinkCache("file2")]);
					}
					return null;
				},
			);

			const changes: IncrementalFileChange[] = [
				{ type: "modify", path: "file1.md" },
			];

			await service.applyFileChangesTimeSliced(changes);

			backlinks = service.getBacklinksForLink("file2.md");
			expect(backlinks.some((b) => b.sourceFile.path === "file1.md")).toBe(true);
		});

		test("delete: deleting a file should remove all its backlinks", async () => {
			const builder = new VaultEnvironmentBuilder([
				{ path: "file1.md", links: ["file2", "file3"] },
				{ path: "file2.md" },
				{ path: "file3.md" },
			]);
			const { service } = builder.build();
			await service.rebuildIndexesTimeSliced();

			expect(service.getBacklinksForLink("file2.md").length).toBeGreaterThan(0);
			expect(service.getBacklinksForLink("file3.md").length).toBeGreaterThan(0);

			const changes: IncrementalFileChange[] = [
				{ type: "delete", path: "file1.md" },
			];

			await service.applyFileChangesTimeSliced(changes);

			const backlinksFile2 = service.getBacklinksForLink("file2.md");
			const backlinksFile3 = service.getBacklinksForLink("file3.md");

			expect(backlinksFile2.some((b) => b.sourceFile.path === "file1.md")).toBe(
				false,
			);
			expect(backlinksFile3.some((b) => b.sourceFile.path === "file1.md")).toBe(
				false,
			);
		});

		test("modify: changing links should update the backlinks map", async () => {
			const builder = new VaultEnvironmentBuilder([
				{ path: "file1.md", links: ["file2"] },
				{ path: "file2.md" },
				{ path: "file3.md" },
			]);
			const { service, mockMetadataCache } = builder.build();
			await service.rebuildIndexesTimeSliced();

			expect(
				service
					.getBacklinksForLink("file2.md")
					.some((b) => b.sourceFile.path === "file1.md"),
			).toBe(true);

			(mockMetadataCache.getFileCache as any).mockImplementation(
				(file: TFile) => {
					if (file.path === "file1.md") {
						return createCachedMetadata([createLinkCache("file3")]);
					}
					return null;
				},
			);

			const changes: IncrementalFileChange[] = [
				{ type: "modify", path: "file1.md" },
			];

			await service.applyFileChangesTimeSliced(changes);

			expect(
				service
					.getBacklinksForLink("file2.md")
					.some((b) => b.sourceFile.path === "file1.md"),
			).toBe(false);
			expect(
				service
					.getBacklinksForLink("file3.md")
					.some((b) => b.sourceFile.path === "file1.md"),
			).toBe(true);
		});

		test("modify multiple files: backlinksMap should reflect all changes", async () => {
			const builder = new VaultEnvironmentBuilder([
				{ path: "file1.md", links: ["target"] },
				{ path: "file2.md", links: [] },
				{ path: "target.md" },
			]);
			const { service, mockMetadataCache } = builder.build();
			await service.rebuildIndexesTimeSliced();

			expect(
				service.getBacklinksForLink("target.md").map((b) => b.sourceFile.path),
			).toContain("file1.md");
			expect(
				service.getBacklinksForLink("target.md").map((b) => b.sourceFile.path),
			).not.toContain("file2.md");

			(mockMetadataCache.getFileCache as any).mockImplementation(
				(file: TFile) => {
					if (file.path === "file2.md") {
						return createCachedMetadata([createLinkCache("target")]);
					}
					if (file.path === "file1.md") {
						return createCachedMetadata([createLinkCache("target")]);
					}
					return null;
				},
			);

			const changes: IncrementalFileChange[] = [
				{ type: "modify", path: "file2.md" },
			];

			await service.applyFileChangesTimeSliced(changes);

			const backlinks = service.getBacklinksForLink("target.md");
			const backlinkPaths = backlinks.map((b) => b.sourceFile.path);
			expect(backlinkPaths).toContain("file1.md");
			expect(backlinkPaths).toContain("file2.md");
		});

		test("remove a link: modifying file to remove link should update backlinksMap", async () => {
			const builder = new VaultEnvironmentBuilder([
				{ path: "file1.md", links: ["file2"] },
				{ path: "file2.md" },
			]);
			const { service, mockMetadataCache } = builder.build();
			await service.rebuildIndexesTimeSliced();

			expect(
				service
					.getBacklinksForLink("file2.md")
					.some((b) => b.sourceFile.path === "file1.md"),
			).toBe(true);

			(mockMetadataCache.getFileCache as any).mockImplementation(
				(file: TFile) => {
					if (file.path === "file1.md") {
						return createCachedMetadata([]);
					}
					return null;
				},
			);

			const changes: IncrementalFileChange[] = [
				{ type: "modify", path: "file1.md" },
			];

			await service.applyFileChangesTimeSliced(changes);

			expect(
				service
					.getBacklinksForLink("file2.md")
					.some((b) => b.sourceFile.path === "file1.md"),
			).toBe(false);
		});

		test("create: when resolution target switches due to shadowing, incremental update moves backlinks to the new target", async () => {
			const builder = new VaultEnvironmentBuilder([
				{ path: "src/source.md", links: ["note"] },
				{ path: "folderA/note.md" },
			]);
			const { service, mockMetadataCache, mockVault } = builder.build();

			const applyShadowingResolver = () => {
				(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
					(linkText: string) => {
						if (linkText === "note") {
							const shadowed =
								mockVault.getAbstractFileByPath("src/note.md");
							if (shadowed instanceof TFile) {
								return shadowed;
							}
							const fallback =
								mockVault.getAbstractFileByPath("folderA/note.md");
							return fallback instanceof TFile ? fallback : null;
						}

						const directPath = linkText.endsWith(".md")
							? linkText
							: `${linkText}.md`;
						const direct = mockVault.getAbstractFileByPath(directPath);
						return direct instanceof TFile ? direct : null;
					},
				);
			};

			applyShadowingResolver();
			await service.rebuildIndexesTimeSliced();

			expect(
				service
					.getBacklinksForLink("folderA/note.md")
					.some((b) => b.sourceFile.path === "src/source.md"),
			).toBe(true);

			builder.addFile({ path: "src/note.md" });
			applyShadowingResolver();

			await service.applyFileChangesTimeSliced([
				{ type: "create", path: "src/note.md" },
			]);

			expect(
				service
					.getBacklinksForLink("src/note.md")
					.some((b) => b.sourceFile.path === "src/source.md"),
			).toBe(true);
			expect(
				service
					.getBacklinksForLink("folderA/note.md")
					.some((b) => b.sourceFile.path === "src/source.md"),
			).toBe(false);
		});

		test("create: lookupKey needed for shadowing detection is preserved even after modify", async () => {
			const builder = new VaultEnvironmentBuilder([
				{ path: "src/source.md", links: ["note"] },
				{ path: "folderA/note.md" },
			]);
			const { service, mockMetadataCache, mockVault } = builder.build();

			const applyShadowingResolver = () => {
				(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
					(linkText: string) => {
						if (linkText === "note") {
							const preferred =
								mockVault.getAbstractFileByPath("src/note.md");
							if (preferred instanceof TFile) {
								return preferred;
							}
							const fallback =
								mockVault.getAbstractFileByPath("folderA/note.md");
							return fallback instanceof TFile ? fallback : null;
						}

						const directPath = linkText.endsWith(".md")
							? linkText
							: `${linkText}.md`;
						const direct = mockVault.getAbstractFileByPath(directPath);
						return direct instanceof TFile ? direct : null;
					},
				);
			};

			applyShadowingResolver();
			await service.rebuildIndexesTimeSliced();

			await service.applyFileChangesTimeSliced([
				{ type: "modify", path: "src/source.md" },
			]);

			builder.addFile({ path: "src/note.md" });
			applyShadowingResolver();

			await service.applyFileChangesTimeSliced([
				{ type: "create", path: "src/note.md" },
			]);

			expect(
				service
					.getBacklinksForLink("src/note.md")
					.some((b) => b.sourceFile.path === "src/source.md"),
			).toBe(true);
			expect(
				service
					.getBacklinksForLink("folderA/note.md")
					.some((b) => b.sourceFile.path === "src/source.md"),
			).toBe(false);
		});

		test("incremental update invalidates query cache case-insensitively for unresolved links", async () => {
			const builder = new VaultEnvironmentBuilder([
				{ path: "A.md", links: ["Foo"] },
			]);
			const { service } = builder.build();
			await service.rebuildIndexesTimeSliced();

			expect(service.getBacklinkCountForLink("foo.md")).toBe(1);

			builder.addFile({ path: "B.md", links: ["Foo"] });
			await service.applyFileChangesTimeSliced([
				{ type: "create", path: "B.md" },
			]);

			expect(service.getBacklinkCountForLink("foo.md")).toBe(2);

			builder.removeFile("B.md");
			await service.applyFileChangesTimeSliced([
				{ type: "delete", path: "B.md" },
			]);

			expect(service.getBacklinkCountForLink("foo.md")).toBe(1);
		});
	});
});
