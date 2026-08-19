import { describe, expect, it, vi } from "vitest";
import {
	buildSearchWorkerContentMap,
	filterSearchWorkerDataset,
	filterSearchWorkerDatasetWithMatchDetails,
	filterSearchWorkerDatasetWithMatchDetailsTimeSliced,
} from "../searchWorkerFilter";

describe("filterSearchWorkerDataset", () => {
	it("uses normalized file content from the index without changing it", () => {
		const contentByPath = buildSearchWorkerContentMap([
			{
				path: "notes/alpha.md",
				content: "mixed case content",
			},
		]);

		expect(contentByPath.get("notes/alpha.md")).toBe("mixed case content");
	});

	it("matches search text and file content", () => {
		const result = filterSearchWorkerDataset(
			{
				datasetVersion: 1,
				items: [
					{
						key: "alpha",
						searchText: "alpha note",
						targetFilePath: "notes/alpha.md",
					},
					{
						key: "beta",
						searchText: "beta note",
						targetFilePath: "notes/beta.md",
					},
				],
				fileContents: [
					{
						path: "notes/beta.md",
						content: "this body contains the target token",
					},
				],
			},
			"TARGET TOKEN",
		);

		expect(result).toEqual(["beta"]);
	});

	it("ignores file content when title-only scope is selected", () => {
		const result = filterSearchWorkerDataset(
			{
				datasetVersion: 1,
				items: [
					{
						key: "beta",
						searchText: "beta note",
						targetFilePath: "notes/beta.md",
					},
				],
				fileContents: [
					{
						path: "notes/beta.md",
						content: "this body contains the target token",
					},
				],
			},
			"TARGET TOKEN",
			"title-only",
		);

		expect(result).toEqual([]);
	});

	it("returns all indices when the query is empty", () => {
		const result = filterSearchWorkerDataset(
			{
				datasetVersion: 1,
				items: [
					{
						key: "alpha",
						searchText: "alpha note",
						targetFilePath: null,
					},
					{
						key: "beta",
						searchText: "beta note",
						targetFilePath: null,
					},
				],
				fileContents: [],
			},
			"   ",
		);

		expect(result).toEqual(["alpha", "beta"]);
	});

	it("requires all space-separated query terms to match", () => {
		const result = filterSearchWorkerDataset(
			{
				datasetVersion: 1,
				items: [
					{
						key: "title-and-body",
						searchText: "alpha note",
						targetFilePath: "notes/title-and-body.md",
					},
					{
						key: "title-only",
						searchText: "alpha note",
						targetFilePath: "notes/title-only.md",
					},
					{
						key: "body-only",
						searchText: "other note",
						targetFilePath: "notes/body-only.md",
					},
				],
				fileContents: [
					{
						path: "notes/title-and-body.md",
						content: "body includes beta",
					},
					{
						path: "notes/title-only.md",
						content: "body has something else",
					},
					{
						path: "notes/body-only.md",
						content: "alpha and beta are both here",
					},
				],
			},
			"alpha   beta",
		);

		expect(result).toEqual(["title-and-body", "body-only"]);
	});

	it("uses a provided content map without rebuilding from fileContents", () => {
		const result = filterSearchWorkerDataset(
			{
				datasetVersion: 1,
				items: [
					{
						key: "alpha",
						searchText: "alpha note",
						targetFilePath: "notes/alpha.md",
					},
				],
				fileContents: [],
			},
			"cached body",
			"title-and-content",
			buildSearchWorkerContentMap([
				{
					path: "notes/alpha.md",
					content: "cached body token",
				},
			]),
		);

		expect(result).toEqual(["alpha"]);
	});

	it("reports whether a match used title text or file content", () => {
		const result = filterSearchWorkerDatasetWithMatchDetails(
			{
				datasetVersion: 1,
				items: [
					{
						key: "title-only",
						searchText: "alpha beta note",
						targetFilePath: "notes/title-only.md",
					},
					{
						key: "content-only",
						searchText: "alpha note",
						targetFilePath: "notes/content-only.md",
					},
				],
				fileContents: [
					{
						path: "notes/title-only.md",
						content: "body has no query",
					},
					{
						path: "notes/content-only.md",
						content: "body includes beta",
					},
				],
			},
			"alpha beta",
		);

		expect(result).toEqual([
			{
				key: "title-only",
				contentMatched: false,
			},
			{
				key: "content-only",
				contentMatched: true,
			},
		]);
	});

	it("yields while filtering large datasets in chunks", async () => {
		const yieldToMainThread = vi.fn(async () => {});
		let now = 0;
		const performanceSpy = vi.spyOn(performance, "now").mockImplementation(() => {
			now += 6;
			return now;
		});
		const matchedItems: Array<{ key: string }> = [];

		try {
			await filterSearchWorkerDatasetWithMatchDetailsTimeSliced({
				dataset: {
					datasetVersion: 1,
					items: Array.from({ length: 260 }, (_unused, index) => ({
						key: `item-${index}`,
						searchText: "alpha note",
						targetFilePath: null,
					})),
					fileContents: [],
				},
				query: "alpha",
				onMatch: (item) => matchedItems.push(item),
				yieldToMainThread,
			});
		} finally {
			performanceSpy.mockRestore();
		}

		expect(matchedItems).toHaveLength(260);
		expect(yieldToMainThread).toHaveBeenCalledTimes(2);
	});

	it("stops time-sliced filtering when cancelled", async () => {
		let cancelled = false;
		const matchedItems: Array<{ key: string }> = [];

		await filterSearchWorkerDatasetWithMatchDetailsTimeSliced({
			dataset: {
				datasetVersion: 1,
				items: Array.from({ length: 3 }, (_unused, index) => ({
					key: `item-${index}`,
					searchText: "alpha note",
					targetFilePath: null,
				})),
				fileContents: [],
			},
			query: "alpha",
			onMatch: (item) => {
				matchedItems.push(item);
				cancelled = true;
			},
			isCancelled: () => cancelled,
		});

		expect(matchedItems).toEqual([{ key: "item-0", contentMatched: false }]);
	});
});
