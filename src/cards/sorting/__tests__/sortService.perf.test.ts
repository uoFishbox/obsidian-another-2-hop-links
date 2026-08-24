import { describe, expect, beforeEach, vi, type MockedObject } from "vitest";
import { SortService } from "../SortService";
import { TFile } from "obsidian";
import type { CardLinkBranch } from "cards/model";
import type { IMetricProvider, SortableItem } from "../types";

describe("SortService Performance", () => {
	let mockMetricProvider: MockedObject<IMetricProvider>;
	let sortService: SortService;

	const createMockFile = (path: string, basename: string): TFile =>
		({ path, basename, stat: { ctime: 1000, mtime: 2000, size: 0 } }) as TFile;

	const createBranch = (name: string): CardLinkBranch => ({
		hop1: {
			rawText: name,
			path: `${name}.md`,
			isUnresolved: false,
			sourceFile: createMockFile("source.md", "source"),
		},
		hop2: [],
	});

	beforeEach(() => {
		mockMetricProvider = {
			getDisplayName: vi.fn((item: any) => item.hop1.rawText),
			getOutgoingLinkCount: vi.fn(() => 0),
			getCreatedTime: vi.fn(() => 0),
			getModifiedTime: vi.fn(() => 0),
			getBacklinkCount: vi.fn(() => 0),
			getFileSize: vi.fn(() => 0),
			getMetricCacheIdentity: vi.fn(() => undefined),
		};

		sortService = new SortService(mockMetricProvider);
	});

	describe("metric call count per sort option", () => {
		test("alphabetical only computes displayName", () => {
			const items = [createBranch("Item1"), createBranch("Item2")];

			sortService.sort(items, "alphabetical");

			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getOutgoingLinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getCreatedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getModifiedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getBacklinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getFileSize).not.toHaveBeenCalled();
		});

		test("created-date only additionally computes createdTime", () => {
			const items = [createBranch("Item1"), createBranch("Item2")];

			sortService.sort(items, "created-date");

			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getCreatedTime).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getOutgoingLinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getModifiedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getBacklinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getFileSize).not.toHaveBeenCalled();
		});

		test("modified-date only additionally computes modifiedTime", () => {
			const items = [createBranch("Item1"), createBranch("Item2")];

			sortService.sort(items, "modified-date");

			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getModifiedTime).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getOutgoingLinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getCreatedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getBacklinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getFileSize).not.toHaveBeenCalled();
		});

		test("backlink-count only additionally computes backlinkCount", () => {
			const items = [createBranch("Item1"), createBranch("Item2")];

			sortService.sort(items, "backlink-count");

			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getBacklinkCount).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getOutgoingLinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getCreatedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getModifiedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getFileSize).not.toHaveBeenCalled();
		});

		test("file-size only additionally computes fileSize", () => {
			const items = [createBranch("Item1"), createBranch("Item2")];

			sortService.sort(items, "file-size");

			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getFileSize).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getOutgoingLinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getCreatedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getModifiedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getBacklinkCount).not.toHaveBeenCalled();
		});
	});

	describe("single item optimization", () => {
		test("does not compute metrics for single element", () => {
			const items = [createBranch("Only")];

			sortService.sort(items, "alphabetical");

			expect(mockMetricProvider.getDisplayName).not.toHaveBeenCalled();
			expect(mockMetricProvider.getOutgoingLinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getCreatedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getModifiedTime).not.toHaveBeenCalled();
			expect(mockMetricProvider.getBacklinkCount).not.toHaveBeenCalled();
			expect(mockMetricProvider.getFileSize).not.toHaveBeenCalled();
		});
	});

	describe("result allocation", () => {
		test("sort does not create a SortResult through sortWithResult", () => {
			const sortWithResultSpy = vi.spyOn(sortService, "sortWithResult");

			sortService.sort(
				[createBranch("Beta"), createBranch("Alpha")],
				"alphabetical",
			);

			expect(sortWithResultSpy).not.toHaveBeenCalled();
		});
	});

	describe("lazy tie-breaker evaluation", () => {
		test("does not compute displayName when numeric primary keys are unique", () => {
			const items = [
				createBranch("Large"),
				createBranch("Small"),
				createBranch("Medium"),
			];
			const sizes = new Map<SortableItem, number>([
				[items[0], 300],
				[items[1], 100],
				[items[2], 200],
			]);
			mockMetricProvider.getFileSize.mockImplementation(
				(item) => sizes.get(item) ?? 0,
			);

			sortService.sort(items, "file-size");

			expect(mockMetricProvider.getFileSize).toHaveBeenCalledTimes(3);
			expect(mockMetricProvider.getDisplayName).not.toHaveBeenCalled();
		});

		test("only computes displayName for items with tied numeric primary keys", () => {
			const tiedLeft = createBranch("Beta");
			const tiedRight = createBranch("Alpha");
			const unique = createBranch("Unique");
			mockMetricProvider.getFileSize.mockImplementation((item) =>
				item === unique ? 200 : 100,
			);

			sortService.sort([tiedLeft, tiedRight, unique], "file-size");

			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledTimes(2);
			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledWith(tiedLeft);
			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledWith(tiedRight);
			expect(mockMetricProvider.getDisplayName).not.toHaveBeenCalledWith(unique);
		});
	});

	describe("memoization", () => {
		test("reuses metric cache for consecutive sorts of same items", () => {
			const items = [createBranch("C"), createBranch("A"), createBranch("B")];

			sortService.sort(items, "alphabetical");
			sortService.sort(items, "alphabetical");

			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledTimes(3);
		});

		test("reuses per-file cache for different items referencing same target file", () => {
			const items = [createBranch("C"), createBranch("A"), createBranch("B")];
			items.forEach((item) => {
				item.hop1.path = "shared.md";
			});
			const sharedFileIdentity = {};
			mockMetricProvider.getMetricCacheIdentity = vi.fn(() => sharedFileIdentity);

			sortService.invalidateCache();
			sortService.sort(items, "backlink-count");

			expect(mockMetricProvider.getBacklinkCount).toHaveBeenCalledTimes(1);
			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledTimes(1);
		});

		test("recomputes metrics after invalidateCache", () => {
			const items = [createBranch("C"), createBranch("A"), createBranch("B")];

			sortService.sort(items, "alphabetical");
			sortService.invalidateCache();
			sortService.sort(items, "alphabetical");

			expect(mockMetricProvider.getDisplayName).toHaveBeenCalledTimes(6);
		});
	});
});
