import { describe, expect, beforeEach, vi, type MockedObject } from "vitest";
import { SortService } from "../SortService";
import { TFile } from "obsidian";
import type { TwoHopLinkBranch, TwoHopIndexedLink, TaggedNote } from "types/domain";
import type { IMetricProvider } from "types/services";
import type { SortOption } from "types/settings";
import type { SortableItem } from "../types";

describe("SortService", () => {
	let mockMetricProvider: MockedObject<IMetricProvider>;
	let sortService: SortService;

	const createMockFile = (path: string, basename: string): TFile => {
		return {
			path,
			basename,
			stat: { ctime: 1000, mtime: 2000, size: 0 },
		} as TFile;
	};

	const createBranch = (name: string): TwoHopLinkBranch => ({
		hop1: {
			rawText: name,
			path: `${name}.md`,
			isUnresolved: false,
			sourceFile: createMockFile("source.md", "source"),
		},
		hop2: [],
	});

	const createBacklink = (name: string): TwoHopIndexedLink => ({
		rawText: name,
		path: `${name}.md`,
		isUnresolved: false,
		sourceFile: createMockFile(`${name}.md`, name),
	});

	const createTaggedNote = (name: string): TaggedNote => ({
		file: createMockFile(`${name}.md`, name),
		commonTags: ["tag1"],
		path: `${name}.md`,
	});

	beforeEach(() => {
		mockMetricProvider = {
			getDisplayName: vi.fn((item: any) => {
				if ("hop1" in item) return item.hop1.rawText;
				if ("sourceFile" in item) return item.sourceFile.basename;
				if ("file" in item) return item.file.basename;
				return "";
			}),
			getOutgoingLinkCount: vi.fn(() => 0),
			getCreatedTime: vi.fn(() => 0),
			getModifiedTime: vi.fn(() => 0),
			getBacklinkCount: vi.fn(() => 0),
			getFileSize: vi.fn(() => 0),
			getMetricCacheIdentity: vi.fn(() => undefined),
		};

		sortService = new SortService(mockMetricProvider);
	});

	describe("Empty array and single element", () => {
		test("returns empty array for empty input", () => {
			expect(sortService.sort([], "alphabetical")).toEqual([]);
		});

		test("returns as-is for single element", () => {
			const items = [createBranch("Only")];
			const result = sortService.sort(items, "alphabetical");
			expect(result).toHaveLength(1);
			expect(result[0].hop1.rawText).toBe("Only");
		});
	});

	describe("unknown sort option", () => {
		test("warns and preserves original order", () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const items = [createBranch("C"), createBranch("A"), createBranch("B")];

			const result = sortService.sort(items, "unknown" as SortOption);

			expect(result.map((item) => item.hop1.rawText)).toEqual(["C", "A", "B"]);
			expect(consoleSpy).toHaveBeenCalledWith(
				"Unknown sort option: unknown, using default",
			);

			consoleSpy.mockRestore();
		});
	});

	describe("sort order correctness", () => {
		it.each([
			{
				name: "alphabetical ascending",
				sortOption: "alphabetical" as SortOption,
				items: ["Zebra", "Apple", "Banana"],
				expected: ["Apple", "Banana", "Zebra"],
			},
			{
				name: "alphabetical descending",
				sortOption: "alphabetical-reverse" as SortOption,
				items: ["C", "A", "B"],
				expected: ["C", "B", "A"],
			},
		])("$name", ({ sortOption, items, expected }) => {
			const branches = items.map((n) => createBranch(n));
			const result = sortService.sort(branches, sortOption);
			expect(result.map((item) => item.hop1.rawText)).toEqual(expected);
		});

		test("created-date ascending", () => {
			mockMetricProvider.getCreatedTime.mockImplementation((item: any) => {
				const order: Record<string, number> = {
					Zebra: 3000,
					Apple: 1000,
					Banana: 2000,
				};
				return order[item.hop1.rawText] ?? 0;
			});

			const result = sortService.sort(
				[createBranch("Zebra"), createBranch("Apple"), createBranch("Banana")],
				"created-date",
			);

			expect(result.map((item) => item.hop1.rawText)).toEqual([
				"Apple",
				"Banana",
				"Zebra",
			]);
		});

		test("modified-date descending", () => {
			mockMetricProvider.getModifiedTime.mockImplementation((item: any) => {
				const order: Record<string, number> = { C: 1000, A: 3000, B: 2000 };
				return order[item.hop1.rawText] ?? 0;
			});

			const result = sortService.sort(
				[createBranch("C"), createBranch("A"), createBranch("B")],
				"modified-date-reverse",
			);

			expect(result.map((item) => item.hop1.rawText)).toEqual(["A", "B", "C"]);
		});

		test("backlink-count descending", () => {
			mockMetricProvider.getBacklinkCount.mockImplementation((item: any) => {
				const order: Record<string, number> = {
					Rare: 10,
					Popular: 100,
					Normal: 50,
				};
				return order[item.hop1.rawText] ?? 0;
			});

			const result = sortService.sort(
				[createBranch("Rare"), createBranch("Popular"), createBranch("Normal")],
				"backlink-count-reverse",
			);

			expect(result.map((item) => item.hop1.rawText)).toEqual([
				"Popular",
				"Normal",
				"Rare",
			]);
		});

		test("file-size ascending", () => {
			mockMetricProvider.getFileSize.mockImplementation((item: any) => {
				const order: Record<string, number> = {
					Large: 9000,
					Small: 100,
					Medium: 500,
				};
				return order[item.hop1.rawText] ?? 0;
			});

			const result = sortService.sort(
				[createBranch("Large"), createBranch("Small"), createBranch("Medium")],
				"file-size",
			);

			expect(result.map((item) => item.hop1.rawText)).toEqual([
				"Small",
				"Medium",
				"Large",
			]);
		});
	});

	describe("Immutability", () => {
		test("original array is not mutated", () => {
			const items = [createBranch("C"), createBranch("A"), createBranch("B")];
			const originalOrder = items.map((item) => item.hop1.rawText);

			sortService.sort(items, "alphabetical");

			expect(items.map((item) => item.hop1.rawText)).toEqual(originalOrder);
		});

		test("sortWithResult returns original array if order unchanged", () => {
			const items = [createBranch("A"), createBranch("B"), createBranch("C")];

			const result = sortService.sortWithResult(items, "alphabetical");

			expect(result.items).toBe(items);
			expect(result.orderChanged).toBe(false);
		});

		test("sortWithResult includes order change in result", () => {
			const items = [createBranch("C"), createBranch("A"), createBranch("B")];

			const result = sortService.sortWithResult(items, "alphabetical");

			expect(result.items).not.toBe(items);
			expect(result.orderChanged).toBe(true);
			expect(result.items.map((item) => item.hop1.rawText)).toEqual([
				"A",
				"B",
				"C",
			]);
		});
	});

	describe("Different item types", () => {
		it.each([
			{
				name: "TwoHopLinkBranch",
				items: [
					createBranch("Zebra"),
					createBranch("Apple"),
					createBranch("Banana"),
				] as SortableItem[],
				getName: (item: SortableItem) =>
					(item as TwoHopLinkBranch).hop1.rawText,
			},
			{
				name: "TwoHopIndexedLink",
				items: [
					createBacklink("Zebra"),
					createBacklink("Apple"),
					createBacklink("Banana"),
				] as SortableItem[],
				getName: (item: SortableItem) =>
					(item as TwoHopIndexedLink).sourceFile.basename,
			},
			{
				name: "TaggedNote",
				items: [
					createTaggedNote("Zebra"),
					createTaggedNote("Apple"),
					createTaggedNote("Banana"),
				] as SortableItem[],
				getName: (item: SortableItem) => (item as TaggedNote).file.basename,
			},
		])("sorting $name", ({ items, getName }) => {
			const result = sortService.sort(items, "alphabetical");
			expect(result.map(getName)).toEqual(["Apple", "Banana", "Zebra"]);
		});
	});

	describe("tie-breaker", () => {
		it.each([
			"created-date",
			"created-date-reverse",
			"modified-date",
			"modified-date-reverse",
			"backlink-count",
			"backlink-count-reverse",
			"file-size",
			"file-size-reverse",
		] as SortOption[])("%s stable sort by displayName on tie", (sortOption) => {
			const alphaTitleItem = createBranch("zzz-note");
			const zuluTitleItem = createBranch("aaa-note");
			mockMetricProvider.getDisplayName.mockImplementation(
				(item: SortableItem) =>
					item === alphaTitleItem ? "Alpha Title" : "Zulu Title",
			);
			mockMetricProvider.getCreatedTime.mockReturnValue(1000);
			mockMetricProvider.getModifiedTime.mockReturnValue(1000);
			mockMetricProvider.getBacklinkCount.mockReturnValue(10);
			mockMetricProvider.getFileSize.mockReturnValue(20);

			const result = sortService.sort(
				[zuluTitleItem, alphaTitleItem],
				sortOption,
			);

			expect(result.map((item) => item.hop1.rawText)).toEqual([
				"zzz-note",
				"aaa-note",
			]);
		});
	});

	describe("displayName equivalent to frontmatter title", () => {
		it.each([
			{
				name: "alphabetical sorts by displayName",
				sortOption: "alphabetical" as SortOption,
				expected: ["zzz-note", "aaa-note"],
			},
			{
				name: "alphabetical-reverse sorts in reverse by displayName",
				sortOption: "alphabetical-reverse" as SortOption,
				expected: ["aaa-note", "zzz-note"],
			},
		])("$name", ({ sortOption, expected }) => {
			const alphaTitleItem = createBranch("zzz-note");
			const zuluTitleItem = createBranch("aaa-note");
			mockMetricProvider.getDisplayName.mockImplementation(
				(item: SortableItem) =>
					item === alphaTitleItem ? "Alpha Title" : "Zulu Title",
			);

			const result = sortService.sort(
				[zuluTitleItem, alphaTitleItem],
				sortOption,
			);

			expect(result.map((item) => item.hop1.rawText)).toEqual(expected);
		});
	});

	describe("cache invalidation", () => {
		test("same results after invalidateCache", () => {
			const items = [createBranch("C"), createBranch("A"), createBranch("B")];

			const result1 = sortService.sort(items, "alphabetical");
			sortService.invalidateCache();
			const result2 = sortService.sort(items, "alphabetical");

			expect(result1.map((item) => item.hop1.rawText)).toEqual(
				result2.map((item) => item.hop1.rawText),
			);
		});
	});
});
