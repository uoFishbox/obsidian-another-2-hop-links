import { describe, expect, it, vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { TFile } from "obsidian";
import type { LinkContext } from "ui/context/linkContext";
import type { ViewItem } from "application/presenters/ViewItem";
import {
	createItemSearchTextCache,
	getItemSearchText,
} from "features/list-view/model/itemSearchText";

vi.mock("obsidian", () => {
	class MockTFile {
		path = "";
		name = "";
		basename = "";
		extension = "md";
		stat = { ctime: 0, mtime: 0, size: 0 };
		parent: unknown = null;
	}

	return {
		TFile: MockTFile,
	};
});

function createLinkContext(params: {
	sourceFile: TFile;
	resolveMap: Map<string, TFile>;
	metadataMap: Map<string, unknown>;
	fileToLinktext?: (
		file: TFile,
		sourcePath: string,
		omitMdExtension?: boolean,
	) => string;
}): LinkContext {
	const fileToLinktext =
		params.fileToLinktext ?? ((file: TFile) => `Link:${file.basename}`);

	return {
		resolveFile: vi.fn((path: string) => params.resolveMap.get(path) ?? null),
		fileToLinktext,
		buildWikiLink: vi.fn(() => "[[link]]"),
		getPreview: vi.fn(async () => ({ type: "empty", content: "" }) as const),
		sourceFile: params.sourceFile,
		getMetadata: vi.fn(
			(file: TFile) => (params.metadataMap.get(file.path) ?? null) as never,
		),
		onOpenFile: vi.fn(),
		onHop1Click: vi.fn(),
		onHop2Click: vi.fn(),
		onTagClick: vi.fn(),
	};
}

describe("getItemSearchText", () => {
	it("includes the frontmatter title and fallback file text for file items", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const file = createMockTFile("notes/alpha.md");
		const context = createLinkContext({
			sourceFile,
			resolveMap: new Map(),
			metadataMap: new Map([
				[file.path, { frontmatter: { title: "Custom Title" } }],
			]),
			fileToLinktext: vi.fn(() => "Alpha Link"),
		});

		const searchText = getItemSearchText(
			{ type: "file", data: file } as ViewItem,
			context,
			{ priorityFrontmatterKeyForTitle: "title" },
		);

		expect(searchText).toContain("custom title");
		expect(searchText).toContain("alpha link");
		expect(searchText).toContain("alpha");
		expect(searchText).toContain("notes/alpha.md");
	});

	it("includes the frontmatter title and path for backlink items", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const backlinkSource = createMockTFile("notes/backlink.md");
		const context = createLinkContext({
			sourceFile,
			resolveMap: new Map(),
			metadataMap: new Map([
				[backlinkSource.path, { frontmatter: { title: "Backlink Title" } }],
			]),
			fileToLinktext: vi.fn(() => "Backlink Link"),
		});

		const searchText = getItemSearchText(
			{
				type: "backlink",
				data: {
					sourceFile: backlinkSource,
					rawText: "backlink raw",
					path: backlinkSource.path,
					isUnresolved: false,
				},
			} as ViewItem,
			context,
			{ priorityFrontmatterKeyForTitle: "title" },
		);

		expect(searchText).toContain("backlink title");
		expect(searchText).toContain("backlink link");
		expect(searchText).toContain("backlink");
		expect(searchText).toContain("notes/backlink.md");
	});

	it("includes the frontmatter title and path for tagged note items", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const taggedFile = createMockTFile("notes/tagged.md");
		const context = createLinkContext({
			sourceFile,
			resolveMap: new Map(),
			metadataMap: new Map([
				[taggedFile.path, { frontmatter: { title: "Tagged Title" } }],
			]),
			fileToLinktext: vi.fn(() => "Tagged Link"),
		});

		const searchText = getItemSearchText(
			{
				type: "taggedNote",
				data: {
					file: taggedFile,
					commonTags: ["alpha"],
					path: taggedFile.path,
				},
			} as ViewItem,
			context,
			{ priorityFrontmatterKeyForTitle: "title" },
		);

		expect(searchText).toContain("tagged title");
		expect(searchText).toContain("tagged link");
		expect(searchText).toContain("tagged");
		expect(searchText).toContain("notes/tagged.md");
		expect(context.fileToLinktext).toHaveBeenCalledWith(
			taggedFile,
			sourceFile.path,
			true,
		);
	});

	it("includes the frontmatter title for resolved branch items and keeps unresolved branches unchanged", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const branchTarget = createMockTFile("notes/branch-target.md");
		const context = createLinkContext({
			sourceFile,
			resolveMap: new Map([[branchTarget.path, branchTarget]]),
			metadataMap: new Map([
				[branchTarget.path, { frontmatter: { title: "Branch Title" } }],
			]),
			fileToLinktext: vi.fn(() => "Branch Link"),
		});

		const resolvedSearchText = getItemSearchText(
			{
				type: "branch",
				data: {
					hop1: {
						rawText: "branch raw",
						displayText: "Hidden Alias",
						path: branchTarget.path,
						isUnresolved: false,
						sourceFile,
					},
					hop2: [],
				},
			} as ViewItem,
			context,
			{ priorityFrontmatterKeyForTitle: "title" },
		);

		expect(resolvedSearchText).toContain("branch title");
		expect(resolvedSearchText).toContain("branch link");
		expect(resolvedSearchText).toContain("branch raw");
		expect(resolvedSearchText).toContain("notes/branch-target.md");
		expect(resolvedSearchText).not.toContain("hidden alias");

		const unresolvedContext = createLinkContext({
			sourceFile,
			resolveMap: new Map(),
			metadataMap: new Map(),
			fileToLinktext: vi.fn(() => "Unused"),
		});

		const unresolvedSearchText = getItemSearchText(
			{
				type: "branch",
				data: {
					hop1: {
						rawText: "unresolved raw",
						path: undefined,
						isUnresolved: true,
						sourceFile,
					},
					hop2: [],
				},
			} as ViewItem,
			unresolvedContext,
			{ priorityFrontmatterKeyForTitle: "title" },
		);

		expect(unresolvedSearchText).toBe("unresolved raw");
		expect(unresolvedContext.fileToLinktext).not.toHaveBeenCalled();
		expect(unresolvedContext.resolveFile).not.toHaveBeenCalled();
	});
});

describe("createItemSearchTextCache", () => {
	it("caches computed search text by item key until cleared", () => {
		const cache = createItemSearchTextCache();
		const compute = vi.fn(() => "alpha");

		expect(cache.get("item-1", compute)).toBe("alpha");
		expect(cache.get("item-1", compute)).toBe("alpha");
		expect(compute).toHaveBeenCalledTimes(1);

		cache.clear();

		expect(cache.get("item-1", compute)).toBe("alpha");
		expect(compute).toHaveBeenCalledTimes(2);
	});
});
