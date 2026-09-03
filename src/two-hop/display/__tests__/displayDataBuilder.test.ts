import { describe, expect, beforeEach, vi } from "vitest";
import { createDisplayDataBuilder } from "../displayDataBuilder";
import type { DisplayData, PreprocessedDisplayData } from "../displayDataBuilder";
import type { TaggedNote } from "indexing/model";
import type { TwoHopLinkBranch, TwoHopLinkResult } from "two-hop/model";
import type { PluginSettings } from "settings/model";
import type { ISortService, SortOption } from "cards/sorting";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { DEFAULT_SETTINGS } from "settings/model";
import * as grouping from "two-hop/display/tagGrouping";

const defaultSettings: PluginSettings = DEFAULT_SETTINGS;

// SortServiceのmock（入力をそのまま返す）
const mockSortService: ISortService = {
	sort: vi.fn((items) => [...items]),
};

function preprocessDisplayData(
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
): PreprocessedDisplayData {
	const builder = createDisplayDataBuilder({
		getLinkTargets: () => new Set(),
		sortService: mockSortService,
	});
	const linkResultData = builder.preprocessLinkDisplayData(linkResult, settings);
	const tagPreprocessed = builder.preprocessTagDisplayData(
		linkResult,
		settings,
		linkResultData.state,
	);
	return { ...linkResultData.data, ...tagPreprocessed };
}

function buildDisplayData(
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	sortOption: SortOption,
	sortService: ISortService,
): DisplayData {
	const builder = createDisplayDataBuilder({
		getLinkTargets: () => new Set(),
		sortService,
	});
	const linkResultData = builder.preprocessLinkDisplayData(linkResult, settings);
	const tagPreprocessed = builder.preprocessTagDisplayData(
		linkResult,
		settings,
		linkResultData.state,
	);
	return builder.sortAndAssembleDisplayData(
		{ ...linkResultData.data, ...tagPreprocessed },
		settings,
		sortOption,
	);
}

describe("DisplayDataBuilder - buildDisplayData", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("edge case: when linkResult is undefined or empty", () => {
		test("when linkResult is undefined, returns empty DisplayData", () => {
			// Act
			const result = buildDisplayData(
				undefined,
				defaultSettings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result).toEqual({
				outgoing: [],
				backlinks: [],
				mergedItems: [],
				twoHopBranches: [],
				tagGroups: [],
				newLinks: [],
			});
		});

		test("when linkResult has empty arrays, returns empty DisplayData", () => {
			// Arrange
			const emptyLinkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [],
				backlinks: [],
				taggedNotes: [],
			};

			// Act
			const result = buildDisplayData(
				emptyLinkResult,
				defaultSettings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result).toEqual({
				outgoing: [],
				backlinks: [],
				mergedItems: [],
				twoHopBranches: [],
				tagGroups: [],
				newLinks: [],
			});
		});
	});

	describe("handling unresolved links (isUnresolved: true)", () => {
		test("unresolved links are extracted to newLinks and excluded from outgoing", () => {
			// Arrange
			const unresolvedLink = {
				rawText: "nonexistent",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("source.md"),
				backlinkCount: 1,
			};

			const resolvedLink = {
				rawText: "existing",
				path: "existing.md",
				isUnresolved: false,
				sourceFile: createMockTFile("source.md"),
				backlinkCount: 5,
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [
					{ hop1: unresolvedLink, hop2: [] },
					{ hop1: resolvedLink, hop2: [] },
				],
				backlinks: [],
				taggedNotes: [],
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				defaultSettings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.newLinks).toHaveLength(1);
			expect(result.newLinks[0].rawText).toBe("nonexistent");
			expect(result.newLinks[0].isUnresolved).toBe(true);
			expect(result.outgoing).toHaveLength(1);
			expect(result.outgoing[0].hop1.rawText).toBe("existing");
		});

		test("unresolved backlinks are extracted to newLinks and excluded from backlinks", () => {
			// Arrange
			const unresolvedBacklink = {
				rawText: "unresolved-backlink",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("backlink-source.md"),
				backlinkCount: 1,
			};

			const resolvedBacklink = {
				rawText: "resolved-backlink",
				path: "resolved.md",
				isUnresolved: false,
				sourceFile: createMockTFile("backlink-source2.md"),
				backlinkCount: 5,
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [],
				backlinks: [unresolvedBacklink, resolvedBacklink],
				taggedNotes: [],
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				defaultSettings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.newLinks).toHaveLength(1);
			expect(result.newLinks[0].rawText).toBe("unresolved-backlink");
			expect(result.backlinks).toHaveLength(1);
			expect(result.backlinks[0].rawText).toBe("resolved-backlink");
		});

		test("unresolved links with backlinkCount >= 2 are excluded from newLinks", () => {
			// Arrange
			const unresolvedLinkHighCount = {
				rawText: "popular-unresolved",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("source.md"),
				backlinkCount: 3,
			};

			const unresolvedLinkLowCount = {
				rawText: "rare-unresolved",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("source2.md"),
				backlinkCount: 1,
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [],
				backlinks: [unresolvedLinkHighCount, unresolvedLinkLowCount],
				taggedNotes: [],
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				defaultSettings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.newLinks).toHaveLength(1);
			expect(result.newLinks[0].rawText).toBe("rare-unresolved");
		});

		test("duplicate unresolved links are deduplicated in newLinks", () => {
			// Arrange
			const unresolvedLink1 = {
				rawText: "duplicate",
				lookupPath: "duplicate.md",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("source1.md"),
				backlinkCount: 1,
			};

			const unresolvedLink2 = {
				rawText: "duplicate",
				lookupPath: "duplicate.md",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("source2.md"),
				backlinkCount: 1,
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [{ hop1: unresolvedLink1, hop2: [] }],
				backlinks: [unresolvedLink2],
				taggedNotes: [],
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				defaultSettings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.newLinks).toHaveLength(1);
			expect(result.newLinks[0].rawText).toBe("duplicate");
		});

		test("unresolved links with same lookupPath are merged in newLinks even if rawText differs", () => {
			const unresolvedBranchLink = {
				rawText: "Missing Note",
				lookupPath: "folder/missing-note.md",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("source1.md"),
				backlinkCount: 1,
			};
			const unresolvedBacklink = {
				rawText: "folder/missing-note",
				lookupPath: "folder/missing-note.md",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("source2.md"),
				backlinkCount: 1,
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [{ hop1: unresolvedBranchLink, hop2: [] }],
				backlinks: [unresolvedBacklink],
				taggedNotes: [],
			};

			const result = buildDisplayData(
				linkResult,
				defaultSettings,
				"alphabetical",
				mockSortService,
			);

			expect(result.newLinks).toHaveLength(1);
			expect(result.newLinks[0].lookupPath).toBe("folder/missing-note.md");
		});
	});

	describe("useMergedLinksSection setting tests", () => {
		test("when useMergedLinksSection: false, outgoing and backlinks are separated", () => {
			// Arrange
			const branch = {
				hop1: {
					rawText: "outgoing-link",
					path: "outgoing.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [],
			};

			const backlink = {
				rawText: "backlink",
				path: "backlink.md",
				isUnresolved: false,
				sourceFile: createMockTFile("backlink-source.md"),
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [branch],
				backlinks: [backlink],
				taggedNotes: [],
			};

			const settings = {
				...defaultSettings,
				useMergedLinksSection: false,
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				settings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.outgoing).toHaveLength(1);
			expect(result.backlinks).toHaveLength(1);
			expect(result.mergedItems).toHaveLength(0);
		});

		test("when useMergedLinksSection: true, outgoing and backlinks are merged into mergedItems", () => {
			// Arrange
			const branch = {
				hop1: {
					rawText: "outgoing-link",
					path: "outgoing.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [],
			};

			const backlink = {
				rawText: "backlink",
				path: "backlink.md",
				isUnresolved: false,
				sourceFile: createMockTFile("backlink-source.md"),
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [branch],
				backlinks: [backlink],
				taggedNotes: [],
			};

			const settings = {
				...defaultSettings,
				useMergedLinksSection: true,
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				settings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.mergedItems).toHaveLength(2);
			expect(result.outgoing).toHaveLength(0);
			expect(result.backlinks).toHaveLength(0);
		});
	});

	describe("presence of deduplicationService injection", () => {
		test("when dedupeCards: false (deduplicationService is undefined), duplicates are preserved", () => {
			// Arrange
			const branch1 = {
				hop1: {
					rawText: "duplicate-link",
					path: "duplicate.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [],
			};

			const branch2 = {
				hop1: {
					rawText: "duplicate-link",
					path: "duplicate.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin-2.md"),
				},
				hop2: [],
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [branch1, branch2],
				backlinks: [],
				taggedNotes: [],
			};

			const settings = {
				...defaultSettings,
				dedupeCards: false,
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				settings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.outgoing).toHaveLength(2);
			expect(result.outgoing[0].hop1.path).toBe("duplicate.md");
			expect(result.outgoing[1].hop1.path).toBe("duplicate.md");
		});

		test("when dedupe is enabled, duplicates are removed across display sections", () => {
			// Arrange
			const branch1 = {
				hop1: {
					rawText: "link1",
					path: "link1.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [],
			};

			const branch2 = {
				hop1: {
					rawText: "link2",
					path: "link1.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [],
			};

			const backlink = {
				rawText: "backlink",
				path: "backlink.md",
				isUnresolved: false,
				sourceFile: createMockTFile("backlink-source.md"),
			};

			const taggedNote = {
				file: createMockTFile("tagged.md"),
				commonTags: ["#tag1"],
				path: "tagged.md",
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [branch1, branch2],
				backlinks: [backlink],
				taggedNotes: [taggedNote],
			};
			const settings = {
				...defaultSettings,
				dedupeCards: true,
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				settings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.outgoing).toHaveLength(1);
			expect(result.outgoing[0].hop1.rawText).toBe("link1");
			expect(result.backlinks).toHaveLength(1);
			expect(result.backlinks[0].rawText).toBe("backlink");
			expect(result.tagGroups).toHaveLength(1);
			expect(result.tagGroups[0].tag).toBe("#tag1");
			expect(result.twoHopBranches).toHaveLength(0); // hop2 が空のため
		});
	});

	describe("excludeAttachments filter", () => {
		test("even with multiple '.' in path, attachment detection uses the final extension", () => {
			const attachmentBranch = {
				hop1: {
					rawText: "image-branch",
					path: "folder.with.dots/image.v1.png",
					isUnresolved: false,
					sourceFile: createMockTFile("folder.with.dots/image.v1.png", "png"),
				},
				hop2: [],
			};

			const noteBranch = {
				hop1: {
					rawText: "note-branch",
					path: "folder.with.dots/note.v1.md",
					isUnresolved: false,
					sourceFile: createMockTFile("folder.with.dots/note.v1.md", "md"),
				},
				hop2: [],
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [attachmentBranch, noteBranch],
				backlinks: [],
				taggedNotes: [],
			};

			const settings = {
				...defaultSettings,
				excludeAttachments: true,
			};

			const result = buildDisplayData(
				linkResult,
				settings,
				"alphabetical",
				mockSortService,
			);

			expect(result.outgoing).toHaveLength(1);
			expect(result.outgoing[0].hop1.rawText).toBe("note-branch");
		});

		test("filters hop2 attachments before dedupe and removes empty two-hop branches", () => {
			const attachmentOnlyBranch: TwoHopLinkBranch = {
				hop1: {
					rawText: "attachment-only",
					path: "attachment-only.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "attachment-only",
						path: "attachment-only.md",
						isUnresolved: false,
						sourceFile: createMockTFile("image.png", "png"),
					},
				],
			};
			const mixedBranch: TwoHopLinkBranch = {
				hop1: {
					rawText: "mixed",
					path: "mixed.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "mixed",
						path: "mixed.md",
						isUnresolved: false,
						sourceFile: createMockTFile("document.pdf", "pdf"),
					},
					{
						rawText: "mixed",
						path: "mixed.md",
						isUnresolved: false,
						sourceFile: createMockTFile("note.md"),
					},
				],
			};

			const result = buildDisplayData(
				{
					originFile: createMockTFile("origin.md"),
					branches: [attachmentOnlyBranch, mixedBranch],
					backlinks: [],
					taggedNotes: [],
				},
				{
					...defaultSettings,
					excludeAttachments: true,
					dedupeCards: true,
				},
				"alphabetical",
				mockSortService,
			);

			expect(result.outgoing).toHaveLength(2);
			expect(result.twoHopBranches).toHaveLength(1);
			expect(result.twoHopBranches[0].hop1.rawText).toBe("mixed");
			expect(
				result.twoHopBranches[0].hop2.map((link) => link.sourceFile.path),
			).toEqual(["note.md"]);
		});

		test("keeps non-attachments when excludeAttachments removes nothing", () => {
			const branch = {
				hop1: {
					rawText: "note-branch",
					path: "note.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2",
						path: "hop2.md",
						isUnresolved: false,
						sourceFile: createMockTFile("note.md"),
					},
				],
			};
			const backlink = {
				rawText: "backlink",
				path: "backlink.md",
				isUnresolved: false,
				sourceFile: createMockTFile("backlink.md"),
			};
			const taggedNote = {
				file: createMockTFile("tagged.md"),
				commonTags: ["#tag"],
				path: "tagged.md",
			};
			const branches = [branch];
			const backlinks = [backlink];
			const taggedNotes = [taggedNote];

			const preprocessed = preprocessDisplayData(
				{
					originFile: createMockTFile("origin.md"),
					branches,
					backlinks,
					taggedNotes,
				},
				{
					...defaultSettings,
					excludeAttachments: true,
				},
			);

			expect(preprocessed.resolvedBranches).toEqual(branches);
			expect(preprocessed.resolvedBacklinks).toEqual(backlinks);
			expect(preprocessed.rawTagGroups).toEqual([
				{ tag: "#tag", notes: taggedNotes },
			]);
		});
	});

	describe("twoHopHeaderSortOrder setting tests", () => {
		test("when twoHopHeaderSortOrder: 'appearance', original order is maintained", () => {
			// Arrange
			const branch1 = {
				hop1: {
					rawText: "link1",
					path: "link1.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-1",
						path: "hop2-1.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link1.md"),
					},
					{
						rawText: "hop2-2",
						path: "hop2-2.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link1.md"),
					},
				],
			};

			const branch2 = {
				hop1: {
					rawText: "link2",
					path: "link2.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-3",
						path: "hop2-3.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link2.md"),
					},
				],
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [branch1, branch2],
				backlinks: [],
				taggedNotes: [],
			};

			const settings = {
				...defaultSettings,
				dedupeCards: false,
				twoHopHeaderSortOrder: "appearance" as const,
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				settings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.twoHopBranches).toHaveLength(2);
			// branch1 が先に来る（hop2.length = 2）
			expect(result.twoHopBranches[0].hop1.rawText).toBe("link1");
			expect(result.twoHopBranches[1].hop1.rawText).toBe("link2");
		});

		test("when twoHopHeaderSortOrder: 'hop2-count-asc', sorted ascending by hop2 count", () => {
			// Arrange
			const branch1 = {
				hop1: {
					rawText: "link1",
					path: "link1.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-1",
						path: "hop2-1.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link1.md"),
					},
					{
						rawText: "hop2-2",
						path: "hop2-2.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link1.md"),
					},
					{
						rawText: "hop2-3",
						path: "hop2-3.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link1.md"),
					},
				],
			};

			const branch2 = {
				hop1: {
					rawText: "link2",
					path: "link2.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-4",
						path: "hop2-4.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link2.md"),
					},
				],
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [branch1, branch2], // branch1 は hop2 が 3 個、branch2 は 1 個
				backlinks: [],
				taggedNotes: [],
			};

			const settings = {
				...defaultSettings,
				dedupeCards: false,
				twoHopHeaderSortOrder: "hop2-count-asc" as const,
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				settings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.twoHopBranches).toHaveLength(2);
			// branch2 が先に来る（hop2.length = 1）
			expect(result.twoHopBranches[0].hop1.rawText).toBe("link2");
			expect(result.twoHopBranches[0].hop2).toHaveLength(1);
			// branch1 が後に来る（hop2.length = 3）
			expect(result.twoHopBranches[1].hop1.rawText).toBe("link1");
			expect(result.twoHopBranches[1].hop2).toHaveLength(3);
		});

		test("when hop2 counts are already ascending, reuses the original branch array", () => {
			const branch1 = {
				hop1: {
					rawText: "link1",
					path: "link1.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-1",
						path: "hop2-1.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link1.md"),
					},
				],
			};
			const branch2 = {
				hop1: {
					rawText: "link2",
					path: "link2.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-2",
						path: "hop2-2.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link2.md"),
					},
					{
						rawText: "hop2-3",
						path: "hop2-3.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link2.md"),
					},
				],
			};
			const branches = [branch1, branch2];

			const preprocessed = preprocessDisplayData(
				{
					originFile: createMockTFile("origin.md"),
					branches,
					backlinks: [],
					taggedNotes: [],
				},
				{
					...defaultSettings,
					dedupeCards: false,
					twoHopHeaderSortOrder: "hop2-count-asc",
				},
			);

			expect(preprocessed.nonEmptyTwoHopBranches).toBe(branches);
		});

		test("branches with empty hop2 are excluded from twoHopBranches", () => {
			// Arrange
			const branchWithHop2 = {
				hop1: {
					rawText: "link1",
					path: "link1.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-1",
						path: "hop2-1.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link1.md"),
					},
				],
			};

			const branchWithoutHop2 = {
				hop1: {
					rawText: "link2",
					path: "link2.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [],
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [branchWithHop2, branchWithoutHop2],
				backlinks: [],
				taggedNotes: [],
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				{ ...defaultSettings, dedupeCards: false },
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.twoHopBranches).toHaveLength(1);
			expect(result.twoHopBranches[0].hop1.rawText).toBe("link1");
		});
	});

	describe("tag group generation", () => {
		test("when showTagsSection is false, tag processing is completely skipped", () => {
			const taggedNote = {
				file: createMockTFile("note1.md"),
				commonTags: ["#tag1"],
				path: "note1.md",
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [],
				backlinks: [],
				taggedNotes: [taggedNote],
			};

			const settings = {
				...defaultSettings,
				showTagsSection: false,
			};

			const groupNotesByTagSpy = vi.spyOn(grouping, "groupNotesByTag");

			const result = buildDisplayData(
				linkResult,
				settings,
				"alphabetical",
				mockSortService,
			);

			expect(result.tagGroups).toHaveLength(0);
			expect(groupNotesByTagSpy).not.toHaveBeenCalled();
		});

		test("taggedNotes is correctly converted to TagGroup", () => {
			// Arrange
			const taggedNote1 = {
				file: createMockTFile("note1.md"),
				commonTags: ["#tag1", "#tag2"],
				path: "note1.md",
			};

			const taggedNote2 = {
				file: createMockTFile("note2.md"),
				commonTags: ["#tag1"],
				path: "note2.md",
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [],
				backlinks: [],
				taggedNotes: [taggedNote1, taggedNote2],
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				defaultSettings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			expect(result.tagGroups.length).toBeGreaterThan(0);
			// #tag1 は 2 つのノートに共通、#tag2 は 1 つのノート
			const tag1Group = result.tagGroups.find((g) => g.tag === "#tag1");
			const tag2Group = result.tagGroups.find((g) => g.tag === "#tag2");

			expect(tag1Group).toBeDefined();
			expect(tag1Group?.notes).toHaveLength(2);
			expect(tag2Group).toBeDefined();
			expect(tag2Group?.notes).toHaveLength(1);
		});
	});

	describe("preprocessed base arrays", () => {
		test("when dedupe is enabled, hop2-count-asc is applied only to nonEmptyTwoHopBranches after dedupe", () => {
			const duplicateBranchLarge = {
				hop1: {
					rawText: "duplicate",
					path: "duplicate.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-1",
						path: "hop2-1.md",
						isUnresolved: false,
						sourceFile: createMockTFile("hop2-source-1.md"),
					},
					{
						rawText: "hop2-2",
						path: "hop2-2.md",
						isUnresolved: false,
						sourceFile: createMockTFile("hop2-source-2.md"),
					},
					{
						rawText: "hop2-3",
						path: "hop2-3.md",
						isUnresolved: false,
						sourceFile: createMockTFile("hop2-source-3.md"),
					},
				],
			};
			const duplicateBranchSmall = {
				hop1: {
					rawText: "duplicate",
					path: "duplicate.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-4",
						path: "hop2-4.md",
						isUnresolved: false,
						sourceFile: createMockTFile("hop2-source-4.md"),
					},
				],
			};
			const distinctBranch = {
				hop1: {
					rawText: "distinct",
					path: "distinct.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-5",
						path: "hop2-5.md",
						isUnresolved: false,
						sourceFile: createMockTFile("hop2-source-5.md"),
					},
					{
						rawText: "hop2-6",
						path: "hop2-6.md",
						isUnresolved: false,
						sourceFile: createMockTFile("hop2-source-6.md"),
					},
				],
			};
			const dedupedBranch = {
				hop1: duplicateBranchLarge.hop1,
				hop2: [...duplicateBranchLarge.hop2, ...duplicateBranchSmall.hop2],
			};
			const preprocessed = preprocessDisplayData(
				{
					originFile: createMockTFile("origin.md"),
					branches: [
						duplicateBranchLarge,
						duplicateBranchSmall,
						distinctBranch,
					],
					backlinks: [],
					taggedNotes: [],
				},
				{
					...defaultSettings,
					dedupeCards: true,
					twoHopHeaderSortOrder: "hop2-count-asc" as const,
				},
			);

			expect(preprocessed.nonEmptyTwoHopBranches).toEqual([
				distinctBranch,
				dedupedBranch,
			]);
		});

		test("when dedupe is enabled, unresolved links remain in newLinks", () => {
			const resolvedBranch = {
				hop1: {
					rawText: "resolved-branch",
					path: "resolved-branch.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [],
			};
			const unresolvedBranch = {
				hop1: {
					rawText: "unresolved-branch",
					path: undefined,
					isUnresolved: true,
					sourceFile: createMockTFile("origin.md"),
					backlinkCount: 1,
				},
				hop2: [],
			};
			const resolvedBacklink = {
				rawText: "resolved-backlink",
				path: "resolved-backlink.md",
				isUnresolved: false,
				sourceFile: createMockTFile("resolved-backlink.md"),
			};
			const unresolvedBacklink = {
				rawText: "unresolved-backlink",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("unresolved-backlink.md"),
				backlinkCount: 0,
			};
			const preprocessed = preprocessDisplayData(
				{
					originFile: createMockTFile("origin.md"),
					branches: [resolvedBranch, unresolvedBranch],
					backlinks: [resolvedBacklink, unresolvedBacklink],
					taggedNotes: [],
				},
				{
					...defaultSettings,
					dedupeCards: true,
				},
			);

			expect(preprocessed.resolvedBranches).toEqual([resolvedBranch]);
			expect(preprocessed.resolvedBacklinks).toEqual([resolvedBacklink]);
			expect(preprocessed.mergedBaseItems).toEqual([
				resolvedBranch,
				resolvedBacklink,
			]);
			expect(preprocessed.newLinks).toEqual([
				unresolvedBranch.hop1,
				unresolvedBacklink,
			]);
			expect(preprocessed.nonEmptyTwoHopBranches).toEqual([]);
		});

		test("nonEmptyTwoHopBranches and mergedBaseItems are determined in preprocessing", () => {
			const branchWithHop2 = {
				hop1: {
					rawText: "link-with-hop2",
					path: "link-with-hop2.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2",
						path: "hop2.md",
						isUnresolved: false,
						sourceFile: createMockTFile("link-with-hop2.md"),
					},
				],
			};
			const branchWithoutHop2 = {
				hop1: {
					rawText: "link-without-hop2",
					path: "link-without-hop2.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [],
			};
			const backlink = {
				rawText: "backlink",
				path: "backlink.md",
				isUnresolved: false,
				sourceFile: createMockTFile("backlink.md"),
			};

			const preprocessed = preprocessDisplayData(
				{
					originFile: createMockTFile("origin.md"),
					branches: [branchWithHop2, branchWithoutHop2],
					backlinks: [backlink],
					taggedNotes: [],
				},
				{ ...defaultSettings, dedupeCards: false },
			);

			expect(preprocessed.nonEmptyTwoHopBranches).toEqual([branchWithHop2]);
			expect(preprocessed.nonEmptyTwoHopBranches[0]).toBe(branchWithHop2);
			expect(preprocessed.mergedBaseItems).toEqual([
				branchWithHop2,
				branchWithoutHop2,
				backlink,
			]);
		});
	});

	describe("combined scenarios", () => {
		test("real use case combining all features", () => {
			// Arrange
			const resolvedBranch = {
				hop1: {
					rawText: "resolved-outgoing",
					path: "resolved.md",
					isUnresolved: false,
					sourceFile: createMockTFile("origin.md"),
				},
				hop2: [
					{
						rawText: "hop2-link",
						path: "hop2.md",
						isUnresolved: false,
						sourceFile: createMockTFile("resolved.md"),
					},
				],
			};

			const unresolvedBranch = {
				hop1: {
					rawText: "unresolved-outgoing",
					path: undefined,
					isUnresolved: true,
					sourceFile: createMockTFile("origin.md"),
					backlinkCount: 1,
				},
				hop2: [],
			};

			const resolvedBacklink = {
				rawText: "resolved-backlink",
				path: "resolved-backlink.md",
				isUnresolved: false,
				sourceFile: createMockTFile("backlink-source.md"),
			};

			const unresolvedBacklink = {
				rawText: "unresolved-backlink",
				path: undefined,
				isUnresolved: true,
				sourceFile: createMockTFile("backlink-source2.md"),
				backlinkCount: 0,
			};

			const taggedNote = {
				file: createMockTFile("tagged.md"),
				commonTags: ["#common"],
				path: "tagged.md",
			};

			const linkResult: TwoHopLinkResult = {
				originFile: createMockTFile("origin.md"),
				branches: [resolvedBranch, unresolvedBranch],
				backlinks: [resolvedBacklink, unresolvedBacklink],
				taggedNotes: [taggedNote],
			};

			const settings = {
				...defaultSettings,
				dedupeCards: false,
				useMergedLinksSection: true,
				twoHopHeaderSortOrder: "hop2-count-asc" as const,
			};

			// Act
			const result = buildDisplayData(
				linkResult,
				settings,
				"alphabetical",
				mockSortService,
			);

			// Assert
			// newLinks には未解決リンクが含まれる
			expect(result.newLinks).toHaveLength(2);
			expect(
				result.newLinks.some((l) => l.rawText === "unresolved-outgoing"),
			).toBe(true);
			expect(
				result.newLinks.some((l) => l.rawText === "unresolved-backlink"),
			).toBe(true);

			// mergedItems には解決済みのリンクのみが含まれる
			expect(result.mergedItems).toHaveLength(2);

			// outgoing と backlinks は空
			expect(result.outgoing).toHaveLength(0);
			expect(result.backlinks).toHaveLength(0);

			// twoHopBranches には hop2 を持つブランチのみ
			expect(result.twoHopBranches).toHaveLength(1);
			expect(result.twoHopBranches[0].hop1.rawText).toBe("resolved-outgoing");

			// tagGroups が生成される
			expect(result.tagGroups).toHaveLength(1);
			expect(result.tagGroups[0].tag).toBe("#common");
		});
	});
});
