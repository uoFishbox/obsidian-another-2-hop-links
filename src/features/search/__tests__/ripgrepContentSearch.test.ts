import { describe, expect, it } from "vitest";
import { filterSearchDatasetWithRipgrepMatches } from "../ripgrepContentSearch";
import type { SearchWorkerItemSnapshot } from "../searchWorkerTypes";

const items: SearchWorkerItemSnapshot[] = [
	{
		key: "title-only",
		searchText: "alpha title",
		targetFilePath: "notes/title-only.md",
	},
	{
		key: "title-and-content",
		searchText: "alpha title",
		targetFilePath: "notes/title-and-content.md",
	},
	{
		key: "content-only",
		searchText: "plain title",
		targetFilePath: "notes/content-only.md",
	},
	{
		key: "missing",
		searchText: "plain title",
		targetFilePath: "notes/missing.md",
	},
];

describe("filterSearchDatasetWithRipgrepMatches", () => {
	it("keeps worker search AND semantics across title and content matches", () => {
		const matchesByTerm = new Map<string, ReadonlySet<string>>([
			[
				"beta",
				new Set(["notes/title-and-content.md", "notes/content-only.md"]),
			],
		]);

		const matchedItems = filterSearchDatasetWithRipgrepMatches(
			items,
			"alpha beta",
			matchesByTerm,
		);

		expect(matchedItems).toEqual([
			{
				key: "title-and-content",
				titleMatched: false,
				contentMatched: true,
			},
		]);
	});

	it("does not drop items when every term is in the title", () => {
		const matchedItems = filterSearchDatasetWithRipgrepMatches(
			items,
			"alpha title",
			new Map(),
		);

		expect(matchedItems).toContainEqual({
			key: "title-only",
			titleMatched: true,
			contentMatched: false,
		});
	});

	it("attaches ripgrep preview text for non-markdown content matches", () => {
		const matchedItems = filterSearchDatasetWithRipgrepMatches(
			[
				{
					key: "pdf",
					searchText: "attachment",
					targetFilePath: "files/reference.txt",
				},
			],
			"needle",
			new Map([["needle", new Set(["files/reference.txt"])]]),
			new Map([["files/reference.txt", "line with needle"]]),
			new Map([
				[
					"files/reference.txt",
					{
						start: { line: 3, col: 10, offset: -1 },
						end: { line: 3, col: 16, offset: -1 },
					},
				],
			]),
		);

		expect(matchedItems).toEqual([
			{
				key: "pdf",
				titleMatched: false,
				contentMatched: true,
				contentPreview: "line with needle",
				contentPosition: {
					start: { line: 3, col: 10, offset: -1 },
					end: { line: 3, col: 16, offset: -1 },
				},
			},
		]);
	});
});
