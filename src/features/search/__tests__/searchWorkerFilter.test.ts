import { describe, expect, it } from "vitest";
import {
	buildSearchWorkerContentMap,
	filterSearchWorkerDataset,
	filterSearchWorkerDatasetWithMatchDetails,
} from "../searchWorkerFilter";

describe("filterSearchWorkerDataset", () => {
	it("normalizes file content to lower-case in the shared content map", () => {
		const contentByPath = buildSearchWorkerContentMap([
			{
				path: "notes/alpha.md",
				content: "MiXeD Case Content",
				mtime: 1,
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
						mtime: 1,
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
						mtime: 1,
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
						mtime: 1,
					},
					{
						path: "notes/title-only.md",
						content: "body has something else",
						mtime: 1,
					},
					{
						path: "notes/body-only.md",
						content: "alpha and beta are both here",
						mtime: 1,
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
					mtime: 1,
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
						mtime: 1,
					},
					{
						path: "notes/content-only.md",
						content: "body includes beta",
						mtime: 1,
					},
				],
			},
			"alpha beta",
		);

		expect(result).toEqual([
			{
				key: "title-only",
				titleMatched: true,
				contentMatched: false,
			},
			{
				key: "content-only",
				titleMatched: false,
				contentMatched: true,
			},
		]);
	});
});
