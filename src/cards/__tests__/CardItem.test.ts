import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { TaggedNote, IndexedLink } from "indexing/model";
import type { CardLinkBranch } from "cards/model";
import {
	getItemClassName,
	getItemRawText,
	getItemTargetFile,
	getCardItemKey,
	type CardItem,
} from "cards/CardItem";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { LinkUtilitiesContext } from "cards/context/linkUtilities";

describe("getCardItemKey", () => {
	it("returns the tagged note path", () => {
		const item: CardItem = {
			type: "taggedNote",
			data: {
				path: "notes/tagged.md",
				file: {
					path: "notes/tagged.md",
					stat: { ctime: 0, mtime: 0, size: 0 },
				} as TFile,
				commonTags: [],
			} as TaggedNote,
		};

		expect(getCardItemKey(item)).toBe("notes/tagged.md");
	});

	it("returns the file path", () => {
		const item: CardItem = {
			type: "file",
			data: {
				path: "notes/file.md",
			} as TFile,
		};

		expect(getCardItemKey(item)).toBe("notes/file.md");
	});

	it("returns the backlink source file path", () => {
		const data: IndexedLink = {
			sourceFile: {
				path: "notes/source.md",
				stat: { ctime: 0, mtime: 0, size: 0 },
			} as TFile,
			rawText: "source",
			displayText: "source",
			isUnresolved: false,
		} as IndexedLink;
		const item: CardItem = {
			type: "backlink",
			data,
		};

		expect(getCardItemKey(item)).toBe("notes/source.md");
	});

	it("returns the branch hop1 path when present", () => {
		const data: CardLinkBranch = {
			hop1: {
				path: "notes/hop1.md",
				rawText: "hop1",
				displayText: "hop1",
				isUnresolved: false,
			} as IndexedLink,
			hop2: [],
		};
		const item: CardItem = {
			type: "branch",
			data,
		};

		expect(getCardItemKey(item)).toBe("notes/hop1.md");
	});

	it("returns the branch lookup path when the hop1 path is unresolved", () => {
		const data: CardLinkBranch = {
			hop1: {
				path: undefined,
				lookupPath: "notes/missing.md",
				rawText: "Missing",
				displayText: "Missing",
				isUnresolved: true,
			} as IndexedLink,
			hop2: [],
		};
		const item: CardItem = {
			type: "branch",
			data,
		};

		expect(getCardItemKey(item)).toBe("notes/missing.md");
	});

	it("returns the new link lookup path when available", () => {
		const item: CardItem = {
			type: "newLink",
			data: {
				sourceFile: {
					path: "notes/source.md",
					stat: { ctime: 0, mtime: 0, size: 0 },
				} as TFile,
				rawText: "Missing",
				lookupPath: "notes/missing.md",
				path: undefined,
				isUnresolved: true,
			} as IndexedLink,
		};

		expect(getCardItemKey(item)).toBe("notes/missing.md");
	});
});

function createIndexedLink(
	sourceFile: TFile,
	overrides: Partial<IndexedLink> = {},
): IndexedLink {
	return {
		sourceFile,
		rawText: "[[target]]",
		displayText: "target",
		path: "notes/target.md",
		isUnresolved: false,
		...overrides,
	} as IndexedLink;
}

function createLinkContext(
	sourceFile: TFile,
	resolvedFile: TFile,
): LinkUtilitiesContext {
	return {
		getPreview: vi.fn(async () => ({ type: "text" as const, content: "" })),
		resolveFile: vi.fn((path) =>
			path === resolvedFile.path ? resolvedFile : null,
		),
		buildWikiLink: vi.fn(() => ""),
		fileToLinktext: vi.fn(() => ""),
		sourceFile,
		getMetadata: vi.fn(() => null),
	};
}

describe("view item presentation", () => {
	it("resolves target files directly from each view-item variant", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/target.md");
		const taggedFile = createMockTFile("notes/tagged.md");
		const context = createLinkContext(sourceFile, targetFile);
		const link = createIndexedLink(sourceFile);
		const items: CardItem[] = [
			{ type: "branch", data: { hop1: link, hop2: [] } },
			{ type: "newLink", data: link },
			{ type: "backlink", data: link },
			{
				type: "taggedNote",
				data: { path: taggedFile.path, file: taggedFile, commonTags: [] },
			},
			{ type: "file", data: targetFile },
		];

		expect(items.map((item) => getItemTargetFile(item, context))).toEqual([
			targetFile,
			null,
			sourceFile,
			taggedFile,
			targetFile,
		]);
		expect(context.resolveFile).toHaveBeenCalledOnce();
		expect(context.resolveFile).toHaveBeenCalledWith("notes/target.md");
	});

	it("returns raw drag text without a strategy object", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const file = createMockTFile("attachments/report.pdf", "pdf");
		const taggedFile = createMockTFile("notes/tagged.md");
		const link = createIndexedLink(sourceFile, { rawText: "[[raw target]]" });

		expect(getItemRawText({ type: "branch", data: { hop1: link, hop2: [] } })).toBe(
			"[[raw target]]",
		);
		expect(getItemRawText({ type: "newLink", data: link })).toBe("[[raw target]]");
		expect(getItemRawText({ type: "backlink", data: link })).toBe("[[raw target]]");
		expect(
			getItemRawText({
				type: "taggedNote",
				data: { path: taggedFile.path, file: taggedFile, commonTags: [] },
			}),
		).toBe("tagged");
		expect(getItemRawText({ type: "file", data: file })).toBe("report");
	});

	it("returns state classes only for new links and branches", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const resolved = createIndexedLink(sourceFile);
		const unresolved = createIndexedLink(sourceFile, { isUnresolved: true });

		expect(getItemClassName({ type: "newLink", data: unresolved })).toBe(
			"cosense-card-links__box--missing",
		);
		expect(
			getItemClassName({ type: "branch", data: { hop1: unresolved, hop2: [] } }),
		).toBe("cosense-card-links__box--missing");
		expect(
			getItemClassName({ type: "branch", data: { hop1: resolved, hop2: [] } }),
		).toBe("cosense-card-links__box--existing");
		expect(getItemClassName({ type: "backlink", data: resolved })).toBeNull();
	});
});
