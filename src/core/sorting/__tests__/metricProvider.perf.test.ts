import { describe, expect, beforeEach, vi, type MockedObject } from "vitest";
import { MetricProvider } from "../MetricProvider";
import { TFile } from "obsidian";
import type { TwoHopLinkBranch, CachedMetadataWithLinkReferences } from "types/domain";
import type { IIndexingService } from "types/services";
import type { IMetadataCache, IVault } from "types/obsidian";
import type { SortingConfiguration } from "../types";

const DEFAULT_SORTING_CONFIGURATION: SortingConfiguration = {
	frontmatterKeyCreatedDate: "",
	frontmatterKeyModifiedDate: "",
};

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

	const createProvider = (overrides: Partial<SortingConfiguration> = {}) =>
		new MetricProvider(mockMetadataCache, mockVault, mockIndexingService, () => ({
			...DEFAULT_SORTING_CONFIGURATION,
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
