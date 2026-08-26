import { describe, expect, it, vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { CardItem } from "cards/CardItem";
import type { ISortService } from "cards/sorting";
import {
	getSortedViewItems,
	pinBookmarkedViewItems,
} from "cards/list/model/searchableItemSorting";

function createTaggedNoteItem(path: string): CardItem {
	const file = createMockTFile(path);
	return {
		type: "taggedNote",
		data: {
			file,
			commonTags: ["alpha"],
			path: file.path,
		},
	} as CardItem;
}

describe("searchableItemSorting", () => {
	it("returns items in the order produced by the sort service", () => {
		const viewItems = [
			createTaggedNoteItem("notes/a.md"),
			createTaggedNoteItem("notes/b.md"),
		];
		const sortService: ISortService = {
			sort: vi.fn((items) => [...items].reverse()),
		};
		const sorted = getSortedViewItems(viewItems, "alphabetical", sortService);

		expect(sortService.sort).toHaveBeenCalledTimes(1);
		expect(sorted).toEqual([viewItems[1], viewItems[0]]);
	});

	it("returns the original array when the sort service preserves order", () => {
		const viewItems = [
			createTaggedNoteItem("notes/a.md"),
			createTaggedNoteItem("notes/b.md"),
		];
		const sortService: ISortService = {
			sort: vi.fn((items) => [...items]),
		};
		const sorted = getSortedViewItems(viewItems, "alphabetical", sortService);

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

		const isBookmarked = vi.fn(() => false);
		const sorted = pinBookmarkedViewItems(viewItems, {
			filePaths: new Set(),
			orderedFilePaths: [],
			isBookmarked,
		});

		expect(sorted).toBe(viewItems);
		expect(isBookmarked).not.toHaveBeenCalled();
	});
});
