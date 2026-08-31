import { describe, expect, test } from "vitest";
import { buildLinkIndexArtifactsChunked } from "../backlink-builder/backlinkIndexer";
import { TagIndexStore } from "../tag-index/TagIndexStore";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";

describe("TagIndexStore", () => {
	test("getSnapshot does not run synchronous full scan even when uninitialized", async () => {
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{ path: "file1.md", tags: ["#tag1"] },
		]).build();
		const store = new TagIndexStore(mockVault, mockMetadataCache);

		const snapshot = store.getSnapshot();

		expect(snapshot.tagToFilePaths.size).toBe(0);
		expect(snapshot.fileEntries.size).toBe(0);
		expect(mockVault.getMarkdownFiles).not.toHaveBeenCalled();
		expect(mockMetadataCache.getFileCache).not.toHaveBeenCalled();
	});

	test("can update tag index with just replace and applyFileChanges", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "file1.md", tags: ["#tag1"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);
		expect(store.getSnapshot().tagToFilePaths.get("tag1")).toBe("file1.md");

		env.builder.addFile({ path: "file1.md", tags: ["#tag2/sub"] });
		await store.applyFileChangesAsync([{ type: "modify", path: "file1.md" }]);

		expect(store.getSnapshot().tagToFilePaths.has("tag1")).toBe(false);
		expect(store.getSnapshot().tagToFilePaths.get("tag2")).toBe("file1.md");
		expect(store.getSnapshot().tagToFilePaths.get("tag2/sub")).toBe("file1.md");

		await store.applyFileChangesAsync([{ type: "delete", path: "file1.md" }]);
		expect(store.getSnapshot().fileEntries.has("file1.md")).toBe(false);
		expect(store.getSnapshot().tagToFilePaths.has("tag2")).toBe(false);
	});

	test("rename removes tags from old path and reassigns them to new path", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "notes/old-name.md", tags: ["#tag1/sub"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);
		env.builder.removeFile("notes/old-name.md");
		env.builder.addFile({ path: "notes/new-name.md", tags: ["#tag1/sub"] });
		env.mockVault.getAbstractFileByPath.mockClear();
		env.mockMetadataCache.getFileCache.mockClear();

		await store.applyFileChangesAsync([
			{
				type: "rename",
				oldPath: "notes/old-name.md",
				newPath: "notes/new-name.md",
			},
		]);

		expect(store.getSnapshot().fileEntries.has("notes/old-name.md")).toBe(false);
		expect(
			store
				.getSnapshot()
				.fileEntries.get("notes/new-name.md")
				?.map((tag) => tag.tag),
		).toEqual(["tag1/sub"]);
		expect(store.getSnapshot().tagToFilePaths.get("tag1")).toBe(
			"notes/new-name.md",
		);
		expect(store.getSnapshot().tagToFilePaths.get("tag1/sub")).toBe(
			"notes/new-name.md",
		);
		// A rename with the same tag set does not need a metadata lookup.
		expect(env.mockMetadataCache.getFileCache).not.toHaveBeenCalled();
	});

	test("rename supplements tags from metadata only when old entry is missing", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "notes/new-name.md", tags: ["#fallback"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		env.mockMetadataCache.getFileCache.mockClear();

		await store.applyFileChangesAsync([
			{
				type: "rename",
				oldPath: "notes/missing-old-name.md",
				newPath: "notes/new-name.md",
			},
		]);

		expect(
			store
				.getSnapshot()
				.fileEntries.get("notes/new-name.md")
				?.map((tag) => tag.tag),
		).toEqual(["fallback"]);
		expect(env.mockMetadataCache.getFileCache).toHaveBeenCalledTimes(1);
	});

	// --- A. body-only edit of tagged file ---
	test("affectedTags and affectedTagSourcePaths are empty for body-only edits", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "note.md", tags: ["#project"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);

		// Change only the body (the tags remain the same).
		const result = await store.applyFileChangesAsync([
			{ type: "modify", path: "note.md" },
		]);

		expect(result.affectedTags.size).toBe(0);
		expect(result.affectedTagSourcePaths.size).toBe(0);
		// The tag index itself remains intact.
		expect(store.getSnapshot().tagToFilePaths.get("project")).toBe("note.md");
	});

	test("link resolution does not read or mutate tag metadata", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "note.md", tags: ["#project"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);
		store.replace(artifacts.tagIndex);
		env.mockVault.getAbstractFileByPath.mockClear();
		env.mockMetadataCache.getFileCache.mockClear();

		const result = await store.applyFileChangesAsync([
			{ type: "resolve", path: "note.md" },
		]);

		expect(result.affectedTags.size).toBe(0);
		expect(result.affectedTagSourcePaths.size).toBe(0);
		expect(env.mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
		expect(env.mockMetadataCache.getFileCache).not.toHaveBeenCalled();
		expect(store.getSnapshot().tagToFilePaths.get("project")).toBe("note.md");
	});

	// --- C. tag membership add/remove ---
	test("tag addition is included in affectedTags and affectedTagSourcePaths", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "note.md", tags: [] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);

		// Add a tag.
		env.builder.addFile({ path: "note.md", tags: ["#project"] });
		const result = await store.applyFileChangesAsync([
			{ type: "modify", path: "note.md" },
		]);

		expect(result.affectedTags.has("project")).toBe(true);
		expect(result.affectedTagSourcePaths.has("note.md")).toBe(true);
		expect(store.getSnapshot().tagToFilePaths.get("project")).toBe("note.md");
	});

	test("tag removal is included in affectedTags and affectedTagSourcePaths", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "note.md", tags: ["#project"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);

		// Remove a tag.
		env.builder.addFile({ path: "note.md", tags: [] });
		const result = await store.applyFileChangesAsync([
			{ type: "modify", path: "note.md" },
		]);

		expect(result.affectedTags.has("project")).toBe(true);
		expect(result.affectedTagSourcePaths.has("note.md")).toBe(true);
		expect(store.getSnapshot().tagToFilePaths.has("project")).toBe(false);
	});

	test("both old and new tags are included in affectedTags when tags change", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "note.md", tags: ["#old"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);

		// Change the tag.
		env.builder.addFile({ path: "note.md", tags: ["#new"] });
		const result = await store.applyFileChangesAsync([
			{ type: "modify", path: "note.md" },
		]);

		expect(result.affectedTags.has("old")).toBe(true);
		expect(result.affectedTags.has("new")).toBe(true);
		expect(result.affectedTagSourcePaths.has("note.md")).toBe(true);
	});

	// --- D. rename of tagged file ---
	test("moved tags are included in affectedTags even when tag set is the same in rename", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "old.md", tags: ["#project"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);
		env.builder.removeFile("old.md");
		env.builder.addFile({ path: "new.md", tags: ["#project"] });

		const result = await store.applyFileChangesAsync([
			{ type: "rename", oldPath: "old.md", newPath: "new.md" },
		]);

		// The tag set is unchanged, but the path membership is affected.
		expect(result.affectedTags.has("project")).toBe(true);
		expect(result.affectedTagSourcePaths.has("old.md")).toBe(true);
		expect(result.affectedTagSourcePaths.has("new.md")).toBe(true);
		expect(store.getSnapshot().tagToFilePaths.get("project")).toBe("new.md");
	});

	test("only moved tags are included in affectedTags when tag set also changes in rename", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "old.md", tags: ["#old"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);
		env.builder.removeFile("old.md");
		env.builder.addFile({ path: "new.md", tags: ["#new"] });

		const result = await store.applyFileChangesAsync([
			{ type: "rename", oldPath: "old.md", newPath: "new.md" },
		]);

		// A rename collects only moved tags; a subsequent modify event corrects differences
		// from the actual file contents.
		expect(result.affectedTags.has("old")).toBe(true);
		expect(result.affectedTags.has("new")).toBe(false);
		expect(result.affectedTagSourcePaths.has("old.md")).toBe(true);
		expect(result.affectedTagSourcePaths.has("new.md")).toBe(true);
		// The tag index moves the old path's tags to the new path.
		expect(store.getSnapshot().tagToFilePaths.get("old")).toBe("new.md");
	});

	test("previous tags are included in affectedTags on delete", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "note.md", tags: ["#project", "#alpha"] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);

		const result = await store.applyFileChangesAsync([
			{ type: "delete", path: "note.md" },
		]);

		expect(result.affectedTags.has("project")).toBe(true);
		expect(result.affectedTags.has("alpha")).toBe(true);
		expect(result.affectedTagSourcePaths.has("note.md")).toBe(true);
		expect(store.getSnapshot().fileEntries.has("note.md")).toBe(false);
	});

	test("affectedTags is empty for body-only edits of files without tags", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "note.md", tags: [] },
		]).build();
		const store = new TagIndexStore(env.mockVault, env.mockMetadataCache);
		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		store.replace(artifacts.tagIndex);

		const result = await store.applyFileChangesAsync([
			{ type: "modify", path: "note.md" },
		]);

		expect(result.affectedTags.size).toBe(0);
		expect(result.affectedTagSourcePaths.size).toBe(0);
	});
});
