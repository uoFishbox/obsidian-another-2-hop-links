import { describe, expect, beforeEach, vi, type MockedObject } from "vitest";
import { MetricProvider, isBranch, isBacklink, isTaggedNote } from "../MetricProvider";
import { TFile } from "obsidian";
import type {
	TwoHopLinkBranch,
	TwoHopIndexedLink,
	TaggedNote,
	CachedMetadataWithLinkReferences,
} from "types/domain";
import type { IIndexingService } from "types/services";
import type { IMetadataCache, IVault } from "types/obsidian";
import { DEFAULT_SETTINGS, type PluginSettings } from "features/settings/model";
import type { SortableItem } from "../types";

describe("ObsidianMetricProvider", () => {
	let mockMetadataCache: MockedObject<IMetadataCache>;
	let mockVault: MockedObject<IVault>;
	let mockIndexingService: MockedObject<IIndexingService>;

	const createMockFile = (
		path: string,
		basename: string,
		ctime = 1000,
		mtime = 2000,
		size = 0,
	): TFile => {
		const file = Object.create(TFile.prototype);
		Object.assign(file, {
			path,
			basename,
			stat: { ctime, mtime, size },
		});
		return file;
	};

	const createProvider = (overrides: Partial<PluginSettings> = {}) =>
		new MetricProvider(mockMetadataCache, mockVault, mockIndexingService, () => ({
			...DEFAULT_SETTINGS,
			...overrides,
		}));

	const makeBranch = (
		hop1Path: string,
		hop1RawText = "link",
		hop1DisplayText?: string,
	): TwoHopLinkBranch => ({
		hop1: {
			rawText: hop1RawText,
			path: hop1Path,
			isUnresolved: !hop1Path,
			sourceFile: createMockFile("source.md", "source"),
			...(hop1DisplayText ? { displayText: hop1DisplayText } : {}),
		},
		hop2: [],
	});

	const makeBacklink = (sourceBasename = "source"): TwoHopIndexedLink => ({
		rawText: "link",
		path: "note.md",
		isUnresolved: false,
		sourceFile: createMockFile("source.md", sourceBasename),
	});

	const makeTaggedNote = (fileBasename = "note"): TaggedNote => ({
		file: createMockFile("note.md", fileBasename),
		commonTags: ["tag1"],
		path: "note.md",
	});

	beforeEach(() => {
		mockMetadataCache = { getFileCache: vi.fn() } as any;
		mockVault = { getAbstractFileByPath: vi.fn() } as any;
		mockIndexingService = { getBacklinkCountForLink: vi.fn() } as any;
	});

	describe("Type Guards", () => {
		it.each([
			{ guard: isBranch, item: "branch", expected: true },
			{ guard: isBacklink, item: "branch", expected: false },
			{ guard: isTaggedNote, item: "branch", expected: false },
			{ guard: isBranch, item: "backlink", expected: false },
			{ guard: isBacklink, item: "backlink", expected: true },
			{ guard: isTaggedNote, item: "backlink", expected: false },
			{ guard: isBranch, item: "taggedNote", expected: false },
			{ guard: isBacklink, item: "taggedNote", expected: false },
			{ guard: isTaggedNote, item: "taggedNote", expected: true },
		])("$guard.name($item) = $expected", ({ guard, item, expected }) => {
			const items: Record<string, SortableItem> = {
				branch: makeBranch("note1.md"),
				backlink: makeBacklink(),
				taggedNote: makeTaggedNote(),
			};
			expect(guard(items[item])).toBe(expected);
		});
	});

	describe("getDisplayName", () => {
		it.each([
			{
				name: "Branch - displayText priority",
				item: makeBranch("note.md", "raw", "Display Text"),
				expected: "Display Text",
			},
			{
				name: "Branch - fallback to rawText if no displayText",
				item: makeBranch("note.md", "RawText"),
				expected: "RawText",
			},
			{
				name: "Branch - empty string if neither",
				item: makeBranch("note.md", ""),
				expected: "",
			},
			{
				name: "Backlink - sourceFile.basename",
				item: makeBacklink("MyNote"),
				expected: "MyNote",
			},
			{
				name: "TaggedNote - file.basename",
				item: makeTaggedNote("TaggedFile"),
				expected: "TaggedFile",
			},
			{
				name: "TFile - basename",
				item: createMockFile("all-notes.md", "All Notes"),
				expected: "All Notes",
			},
		])("$name", ({ item, expected }) => {
			const provider = createProvider();
			expect(provider.getDisplayName(item as SortableItem)).toBe(expected);
		});

		it.each([
			{
				name: "Branch - frontmatter title priority",
				item: makeBranch("note.md") as SortableItem,
				targetPath: "note.md",
			},
			{
				name: "Backlink - frontmatter title priority",
				item: makeBacklink("MyNote") as SortableItem,
				targetPath: null,
			},
			{
				name: "TaggedNote - frontmatter title priority",
				item: makeTaggedNote("TaggedFile") as SortableItem,
				targetPath: null,
			},
			{
				name: "TFile - frontmatter title priority",
				item: createMockFile("all-notes.md", "All Notes"),
				targetPath: null,
			},
		])("$name", ({ item, targetPath }) => {
			const expected = "FM Title";
			const targetFile = targetPath ? createMockFile(targetPath, "base") : null;

			if (targetFile) {
				mockVault.getAbstractFileByPath.mockReturnValue(targetFile);
				mockMetadataCache.getFileCache.mockImplementation((file) => {
					if (file === targetFile) {
						return { frontmatter: { title: expected } } as never;
					}
					return null;
				});
			} else {
				const file = (
					"sourceFile" in item && !("hop1" in item)
						? item.sourceFile
						: "file" in item && "commonTags" in item
							? item.file
							: item
				) as TFile;
				mockMetadataCache.getFileCache.mockImplementation((f) => {
					if (f === file) {
						return { frontmatter: { title: expected } } as never;
					}
					return null;
				});
			}

			const provider = createProvider({
				priorityFrontmatterKeyForTitle: "title",
			});
			expect(provider.getDisplayName(item)).toBe(expected);
		});

		test("frontmatter key specified but no property, falls back to default display", () => {
			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatter: {},
			} as never);

			const provider = createProvider({
				priorityFrontmatterKeyForTitle: "title",
			});
			expect(provider.getDisplayName(makeBacklink("MyNote"))).toBe("MyNote");
		});
	});

	describe("getOutgoingLinkCount", () => {
		it.each([
			{
				name: "Branch - link count of hop1.path file",
				item: makeBranch("note.md") as SortableItem,
				targetPath: "note.md",
				links: [
					{ link: "t1", position: {} as any },
					{ link: "t2", position: {} as any },
					{ link: "t3", position: {} as any },
				],
				expected: 3,
			},
			{
				name: "Backlink - link count of sourceFile",
				item: makeBacklink("source") as SortableItem,
				targetPath: null,
				links: [{ link: "target", position: {} as any }],
				expected: 1,
			},
			{
				name: "TaggedNote - link count of file",
				item: makeTaggedNote("note") as SortableItem,
				targetPath: null,
				links: [
					{ link: "t1", position: {} as any },
					{ link: "t2", position: {} as any },
				],
				expected: 2,
			},
		])("$name", ({ item, targetPath, links, expected }) => {
			const provider = createProvider();
			const file = targetPath ? createMockFile(targetPath, "base") : null;

			if (file) {
				mockVault.getAbstractFileByPath.mockReturnValue(file);
				mockMetadataCache.getFileCache.mockImplementation((f) => {
					if (f === file) {
						return { links } as CachedMetadataWithLinkReferences;
					}
					return null;
				});
			} else {
				mockMetadataCache.getFileCache.mockReturnValue({
					links,
				} as CachedMetadataWithLinkReferences);
			}

			expect(provider.getOutgoingLinkCount(item)).toBe(expected);
		});

		it.each([
			{
				name: "returns 0 if path undefined",
				item: makeBranch("") as SortableItem,
			},
			{
				name: "returns 0 if no cache",
				item: makeBacklink("source") as SortableItem,
			},
		])("$name", ({ item }) => {
			const provider = createProvider();
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockMetadataCache.getFileCache.mockReturnValue(
				{} as CachedMetadataWithLinkReferences,
			);
			expect(provider.getOutgoingLinkCount(item)).toBe(0);
		});
	});

	describe("getCreatedTime / getModifiedTime", () => {
		it.each([
			{
				name: "Branch - ctime of hop1.path file",
				method: "getCreatedTime" as const,
				item: makeBranch("note.md") as SortableItem,
				targetPath: "note.md",
				ctime: 12345,
				mtime: 67890,
				expected: 12345,
			},
			{
				name: "Branch - mtime of hop1.path file",
				method: "getModifiedTime" as const,
				item: makeBranch("note.md") as SortableItem,
				targetPath: "note.md",
				ctime: 12345,
				mtime: 67890,
				expected: 67890,
			},
			{
				name: "Backlink - sourceFile ctime",
				method: "getCreatedTime" as const,
				item: {
					rawText: "link",
					path: "note.md",
					isUnresolved: false,
					sourceFile: createMockFile("source.md", "source", 99999, 0),
				} as TwoHopIndexedLink,
				targetPath: null,
				ctime: 99999,
				mtime: 0,
				expected: 99999,
			},
			{
				name: "Backlink - sourceFile mtime",
				method: "getModifiedTime" as const,
				item: {
					rawText: "link",
					path: "note.md",
					isUnresolved: false,
					sourceFile: createMockFile("source.md", "source", 0, 88888),
				} as TwoHopIndexedLink,
				targetPath: null,
				ctime: 0,
				mtime: 88888,
				expected: 88888,
			},
			{
				name: "TaggedNote - file ctime",
				method: "getCreatedTime" as const,
				item: {
					file: createMockFile("note.md", "note", 55555, 0),
					commonTags: ["tag1"],
					path: "note.md",
				} as TaggedNote,
				targetPath: null,
				ctime: 55555,
				mtime: 0,
				expected: 55555,
			},
			{
				name: "TaggedNote - file mtime",
				method: "getModifiedTime" as const,
				item: {
					file: createMockFile("note.md", "note", 0, 77777),
					commonTags: ["tag1"],
					path: "note.md",
				} as TaggedNote,
				targetPath: null,
				ctime: 0,
				mtime: 77777,
				expected: 77777,
			},
			{
				name: "TFile - stat.ctime",
				method: "getCreatedTime" as const,
				item: createMockFile("all-notes.md", "All Notes", 11111, 0),
				targetPath: null,
				ctime: 11111,
				mtime: 0,
				expected: 11111,
			},
			{
				name: "TFile - stat.mtime",
				method: "getModifiedTime" as const,
				item: createMockFile("all-notes.md", "All Notes", 0, 22222),
				targetPath: null,
				ctime: 0,
				mtime: 22222,
				expected: 22222,
			},
		])("$name", ({ method, item, targetPath, ctime, mtime, expected }) => {
			const provider = createProvider();

			if (targetPath) {
				const file = createMockFile(targetPath, "base", ctime, mtime);
				mockVault.getAbstractFileByPath.mockReturnValue(file);
			}

			expect(provider[method](item)).toBe(expected);
		});

		it.each([
			{
				name: "Branch - 0 if file not found (created)",
				method: "getCreatedTime" as const,
				item: makeBranch("nonexistent.md") as SortableItem,
			},
			{
				name: "Branch - 0 if path undefined (modified)",
				method: "getModifiedTime" as const,
				item: makeBranch("") as SortableItem,
			},
		])("$name", ({ method, item }) => {
			const provider = createProvider();
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			expect(provider[method](item)).toBe(0);
		});
	});

	describe("frontmatter date", () => {
		it.each([
			{
				name: "created - frontmatter Date object priority",
				method: "getCreatedTime" as const,
				key: "created",
				fmValue: new Date("2024-03-15T10:30:00Z"),
				expected: new Date("2024-03-15T10:30:00Z").getTime(),
			},
			{
				name: "created - frontmatter string parsing",
				method: "getCreatedTime" as const,
				key: "created",
				fmValue: "2024-03-15",
				expected: Date.parse("2024-03-15"),
			},
			{
				name: "created - frontmatter numeric as-is",
				method: "getCreatedTime" as const,
				key: "created",
				fmValue: 1710500000000,
				expected: 1710500000000,
			},
			{
				name: "modified - frontmatter string parsing",
				method: "getModifiedTime" as const,
				key: "updated",
				fmValue: "2024-06-01",
				expected: Date.parse("2024-06-01"),
			},
		])("$name", ({ method, key, fmValue, expected }) => {
			const file = createMockFile("note.md", "note", 1000, 2000);
			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatter: { [key]: fmValue },
			} as never);

			const provider = createProvider({
				[key === "created"
					? "frontmatterKeyCreatedDate"
					: "frontmatterKeyModifiedDate"]: key,
			});

			expect(provider[method](file)).toBe(expected);
		});

		it.each([
			{
				name: "falls back to stat if value is invalid",
				fmValue: "invalid-date-string",
				expected: 1000,
			},
			{
				name: "falls back to stat if no property",
				fmValue: undefined,
				expected: 1000,
			},
		])("$name", ({ fmValue, expected }) => {
			const file = createMockFile("note.md", "note", 1000, 2000);
			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatter: { created: fmValue },
			} as never);

			const provider = createProvider({
				frontmatterKeyCreatedDate: "created",
			});

			expect(provider.getCreatedTime(file)).toBe(expected);
		});
	});

	describe("getBacklinkCount", () => {
		it.each([
			{
				name: "Branch - retrieved by hop1.path",
				item: makeBranch("note.md") as SortableItem,
				targetPath: "note.md",
				count: 42,
			},
			{
				name: "Backlink - retrieved by sourceFile.path",
				item: makeBacklink("source") as SortableItem,
				targetPath: null,
				count: 15,
			},
			{
				name: "TaggedNote - retrieved by file.path",
				item: makeTaggedNote("note") as SortableItem,
				targetPath: null,
				count: 8,
			},
			{
				name: "TFile - retrieved by file.path",
				item: createMockFile("all-notes.md", "All Notes"),
				targetPath: null,
				count: 27,
			},
		])("$name", ({ item, targetPath, count }) => {
			const provider = createProvider();
			mockIndexingService.getBacklinkCountForLink.mockReturnValue(count);
			if (targetPath) {
				mockVault.getAbstractFileByPath.mockReturnValue(
					createMockFile(targetPath, "base"),
				);
			}
			expect(provider.getBacklinkCount(item)).toBe(count);
		});

		test("returns 0 when file not found", () => {
			const provider = createProvider();
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			expect(provider.getBacklinkCount(makeBranch("nonexistent.md"))).toBe(0);
			expect(mockIndexingService.getBacklinkCountForLink).not.toHaveBeenCalled();
		});
	});

	describe("getFileSize", () => {
		it.each([
			{
				name: "Branch - file size of hop1.path",
				item: makeBranch("note.md") as SortableItem,
				targetPath: "note.md",
				size: 5000,
				expected: 5000,
			},
			{
				name: "Backlink - file size of sourceFile",
				item: {
					rawText: "link",
					path: "note.md",
					isUnresolved: false,
					sourceFile: createMockFile("source.md", "source", 1000, 2000, 3000),
				} as TwoHopIndexedLink,
				targetPath: null,
				size: 3000,
				expected: 3000,
			},
			{
				name: "TaggedNote - file size of file",
				item: {
					file: createMockFile("note.md", "note", 1000, 2000, 7500),
					commonTags: ["tag1"],
					path: "note.md",
				} as TaggedNote,
				targetPath: null,
				size: 7500,
				expected: 7500,
			},
			{
				name: "TFile - stat.size",
				item: createMockFile("all-notes.md", "All Notes", 0, 0, 12000),
				targetPath: null,
				size: 12000,
				expected: 12000,
			},
		])("$name", ({ item, targetPath, size, expected }) => {
			const provider = createProvider();
			if (targetPath) {
				mockVault.getAbstractFileByPath.mockReturnValue(
					createMockFile(targetPath, "base", 0, 0, size),
				);
			}
			expect(provider.getFileSize(item)).toBe(expected);
		});

		test("returns 0 when file not found", () => {
			const provider = createProvider();
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			expect(provider.getFileSize(makeBranch("nonexistent.md"))).toBe(0);
		});
	});

	describe("getMetricCacheIdentity", () => {
		test("returns the target file identity", () => {
			const provider = createProvider({
				frontmatterKeyCreatedDate: "created",
			});
			const file = createMockFile("note.md", "note", 1000, 2345);

			expect(provider.getMetricCacheIdentity("createdTime", file)).toBe(file);
		});

		test("branch displayName does not cache per-file to preserve aliases", () => {
			const provider = createProvider();
			mockVault.getAbstractFileByPath.mockReturnValue(
				createMockFile("note.md", "note"),
			);

			expect(
				provider.getMetricCacheIdentity("displayName", makeBranch("note.md")),
			).toBeUndefined();
		});

		test("branch file metrics cache per resolved file", () => {
			const provider = createProvider();
			const file = createMockFile("note.md", "note", 1000, 3456);
			mockVault.getAbstractFileByPath.mockReturnValue(file);

			expect(
				provider.getMetricCacheIdentity("backlinkCount", makeBranch("note.md")),
			).toBe(file);
		});
	});
});
