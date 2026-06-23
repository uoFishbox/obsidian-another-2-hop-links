import { describe, expect, beforeEach, vi, type MockedObject } from "vitest";
import { MetricProvider } from "../MetricProvider";
import { TFile } from "obsidian";
import type { TwoHopLinkBranch, CachedMetadataWithLinkReferences } from "types/domain";
import type { IIndexingService } from "types/services";
import type { IMetadataCache, IVault } from "types/obsidian";
import { DEFAULT_SETTINGS, type PluginSettings } from "types/settings";

describe("MetricProvider Performance", () => {
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
		Object.assign(file, { path, basename, stat: { ctime, mtime, size } });
		return file;
	};

	const createProvider = (overrides: Partial<PluginSettings> = {}) =>
		new MetricProvider(mockMetadataCache, mockVault, mockIndexingService, () => ({
			...DEFAULT_SETTINGS,
			...overrides,
		}));

	beforeEach(() => {
		mockMetadataCache = { getFileCache: vi.fn() } as any;
		mockVault = { getAbstractFileByPath: vi.fn() } as any;
		mockIndexingService = { getBacklinkCountForLink: vi.fn() } as any;
	});

	describe("getOutgoingLinkCount call behavior", () => {
		test("Branch calls vault.getAbstractFileByPath once", () => {
			const provider = createProvider();
			const mockFile = createMockFile("note.md", "note");
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "link",
					path: "note.md",
					isUnresolved: false,
					sourceFile: createMockFile("source.md", "source"),
				},
				hop2: [],
			};

			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockMetadataCache.getFileCache.mockReturnValue({
				links: [{ link: "t", position: {} as any }],
			} as CachedMetadataWithLinkReferences);

			provider.getOutgoingLinkCount(branch);

			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledTimes(1);
			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith("note.md");
		});

		test("Branch does not call vault.getAbstractFileByPath if path is undefined", () => {
			const provider = createProvider();
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "link",
					path: undefined,
					isUnresolved: true,
					sourceFile: createMockFile("source.md", "source"),
				},
				hop2: [],
			};

			provider.getOutgoingLinkCount(branch);

			expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
		});
	});

	describe("getBacklinkCount call behavior", () => {
		test("Branch does not call indexingService if file not found", () => {
			const provider = createProvider();
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "link",
					path: "nonexistent.md",
					isUnresolved: true,
					sourceFile: createMockFile("source.md", "source"),
				},
				hop2: [],
			};

			provider.getBacklinkCount(branch);

			expect(mockIndexingService.getBacklinkCountForLink).not.toHaveBeenCalled();
		});
	});

	describe("getDisplayName call behavior", () => {
		test("Branch does not call vault.getAbstractFileByPath when frontmatter title key is empty", () => {
			const provider = createProvider();
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "link",
					path: "note.md",
					isUnresolved: false,
					sourceFile: createMockFile("source.md", "source"),
				},
				hop2: [],
			};

			provider.getDisplayName(branch);

			expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
			expect(mockMetadataCache.getFileCache).not.toHaveBeenCalled();
		});

		test("Branch calls vault.getAbstractFileByPath when frontmatter title key is set", () => {
			const provider = createProvider({
				priorityFrontmatterKeyForTitle: "title",
			});
			const mockFile = createMockFile("note.md", "note");
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "link",
					path: "note.md",
					isUnresolved: false,
					sourceFile: createMockFile("source.md", "source"),
				},
				hop2: [],
			};

			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatter: { title: "Note Title" },
			} as any);

			const displayName = provider.getDisplayName(branch);

			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledTimes(1);
			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith("note.md");
			expect(displayName).toBe("Note Title");
		});
	});

	describe("getTargetFile resolution", () => {
		test("Branch treats TFolder return as undefined", () => {
			const provider = createProvider();
			const branch: TwoHopLinkBranch = {
				hop1: {
					rawText: "link",
					path: "folder",
					isUnresolved: false,
					sourceFile: createMockFile("source.md", "source"),
				},
				hop2: [],
			};

			mockVault.getAbstractFileByPath.mockReturnValue({
				path: "folder",
			} as any);

			const time = provider.getCreatedTime(branch);

			expect(time).toBe(0);
		});
	});
});
