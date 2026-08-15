import { describe, expect, it, vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { ViewItem } from "application/presenters";
import type { ISortService } from "core/sorting";
import {
	createViewItemSortCache,
	getSortedViewItemsWithCache,
	pinBookmarkedViewItems,
} from "../searchableItemSorting";

function createTaggedNoteItem(path: string): ViewItem {
	const file = createMockTFile(path);
	return {
		type: "taggedNote",
		data: {
			file,
			commonTags: ["alpha"],
			path: file.path,
		},
	} as ViewItem;
}

describe("searchableItemSorting", () => {
	it("memoizes sorted view items for the same array, sort option, and settings signature", () => {
		const viewItems = [
			createTaggedNoteItem("notes/a.md"),
			createTaggedNoteItem("notes/b.md"),
		];
		const sortService: ISortService = {
			sort: vi.fn((items) => [...items].reverse()),
		};
		const cache = createViewItemSortCache();

		const first = getSortedViewItemsWithCache(
			viewItems,
			"alphabetical",
			"created|modified",
			sortService,
			cache,
		);
		const second = getSortedViewItemsWithCache(
			viewItems,
			"alphabetical",
			"created|modified",
			sortService,
			cache,
		);

		expect(sortService.sort).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	it("invalidates the cache when the sort settings signature changes", () => {
		const viewItems = [
			createTaggedNoteItem("notes/a.md"),
			createTaggedNoteItem("notes/b.md"),
		];
		const sortService: ISortService = {
			sort: vi.fn((items) => [...items].reverse()),
		};
		const cache = createViewItemSortCache();

		const first = getSortedViewItemsWithCache(
			viewItems,
			"alphabetical",
			"created-a|modified",
			sortService,
			cache,
		);
		const second = getSortedViewItemsWithCache(
			viewItems,
			"alphabetical",
			"created-b|modified",
			sortService,
			cache,
		);

		expect(sortService.sort).toHaveBeenCalledTimes(2);
		expect(second).not.toBe(first);
	});

	it("returns the original array when the sort service preserves order", () => {
		const viewItems = [
			createTaggedNoteItem("notes/a.md"),
			createTaggedNoteItem("notes/b.md"),
		];
		const sortService: ISortService = {
			sort: vi.fn((items) => [...items]),
		};
		const cache = createViewItemSortCache();

		const sorted = getSortedViewItemsWithCache(
			viewItems,
			"alphabetical",
			"created|modified",
			sortService,
			cache,
		);

		expect(sortService.sort).toHaveBeenCalledTimes(1);
		expect(sorted).toBe(viewItems);
	});

	it("pins bookmarked items before non-bookmarked items using bookmark panel order", () => {
		const alpha = createTaggedNoteItem("notes/alpha.md");
		const beta = createTaggedNoteItem("notes/beta.md");
		const gamma = createTaggedNoteItem("notes/gamma.md");
		const delta = createTaggedNoteItem("notes/delta.md");
		const bookmarkedPaths = new Set(["notes/gamma.md", "notes/alpha.md"]);

		const sorted = pinBookmarkedViewItems([beta, gamma, delta, alpha], {
			filePaths: bookmarkedPaths,
			orderedFilePaths: ["notes/gamma.md", "notes/alpha.md"],
			isBookmarked: (path) => !!path && bookmarkedPaths.has(path),
		});

		expect(sorted).toEqual([gamma, alpha, beta, delta]);
	});

	it("returns the original array when no items are bookmarked", () => {
		const viewItems = [
			createTaggedNoteItem("notes/a.md"),
			createTaggedNoteItem("notes/b.md"),
		];

		const sorted = pinBookmarkedViewItems(viewItems, {
			filePaths: new Set(),
			orderedFilePaths: [],
			isBookmarked: () => false,
		});

		expect(sorted).toBe(viewItems);
	});
});
