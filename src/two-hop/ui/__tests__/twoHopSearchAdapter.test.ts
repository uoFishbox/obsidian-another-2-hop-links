import { describe, expect, it, vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { TFile } from "obsidian";
import type { TagGroup, TwoHopLinkBranch } from "two-hop/model";
import type { TaggedNote, IndexedLink } from "indexing/model";
import type { SearchMatchedItem } from "search/searchTypes";
import type { DisplayData } from "two-hop/display/displayDataBuilder";
import {
	buildTwoHopSearchSnapshot,
	type TwohopSearchAdapterOptions,
	type TwohopSearchRenderMode,
} from "two-hop/ui/twoHopSearchAdapter";

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
		normalizePath: vi.fn((path: string) => path.replace(/\\/g, "/")),
	};
});

function createSearchAdapterHarness() {
	return {
		buildSnapshot: buildTwoHopSearchSnapshot,
		buildDataset: (options: TwohopSearchAdapterOptions) =>
			buildTwoHopSearchSnapshot(options).items,
	};
}

function createBacklink(sourceFile: TFile, rawText: string): IndexedLink {
	return {
		sourceFile,
		rawText,
		path: sourceFile.path,
		isUnresolved: false,
		backlinkCount: 0,
	};
}

function createBranch(
	sourceFile: TFile,
	targetPath: string | undefined,
	rawText: string,
	hop2: IndexedLink[] = [],
): TwoHopLinkBranch {
	return {
		hop1: {
			sourceFile,
			rawText,
			path: targetPath,
			isUnresolved: targetPath === undefined,
		},
		hop2,
	};
}

function createTaggedNote(file: TFile, tag: string = "alpha"): TaggedNote {
	return {
		file,
		commonTags: [tag],
		path: file.path,
	};
}

function createDisplayData(partial: Partial<DisplayData> = {}): DisplayData {
	return {
		outgoing: [],
		backlinks: [],
		mergedItems: [],
		twoHopBranches: [],
		tagGroups: [],
		newLinks: [],
		...partial,
	};
}

const DEFAULT_RENDER_MODE: TwohopSearchRenderMode = {
	useMergedLinks: false,
	showTags: true,
};

function applyIncrementalMatches(
	options: TwohopSearchAdapterOptions,
	keys: readonly string[],
): DisplayData {
	return buildTwoHopSearchSnapshot(options)
		.createIncrementalFilter()
		.append(
			keys.map(
				(key): SearchMatchedItem => ({
					key,
					contentMatched: false,
				}),
			),
		);
}

function createAdapterOptions(
	displayData: DisplayData,
	sourceFile: TFile,
	renderMode: TwohopSearchRenderMode = DEFAULT_RENDER_MODE,
) {
	const filesByPath = new Map<string, TFile>();
	const metadataByPath = new Map<string, unknown>();

	const addFile = (file: TFile | null | undefined) => {
		if (file) {
			filesByPath.set(file.path, file);
		}
	};

	for (const branch of displayData.outgoing) {
		if (branch.hop1.path) {
			addFile(createMockTFile(branch.hop1.path));
		}
	}
	for (const link of displayData.backlinks) {
		addFile(link.sourceFile);
	}
	for (const item of displayData.mergedItems) {
		if ("hop1" in item && item.hop1.path) {
			addFile(createMockTFile(item.hop1.path));
		}
		if ("sourceFile" in item) {
			addFile(item.sourceFile);
		}
	}
	for (const branch of displayData.twoHopBranches) {
		if (branch.hop1.path) {
			addFile(createMockTFile(branch.hop1.path));
		}
		for (const link of branch.hop2) {
			addFile(link.sourceFile);
		}
	}
	for (const section of displayData.tagGroups) {
		for (const note of section.notes) {
			addFile(note.file);
		}
	}

	return {
		displayData,
		renderMode,
		resolveFile: vi.fn((path: string) => filesByPath.get(path) ?? null),
		fileToLinktext: vi.fn((file: TFile) => `${file.basename} Link`),
		sourcePath: sourceFile.path,
		getMetadata: vi.fn(
			(file: TFile) => (metadataByPath.get(file.path) ?? null) as never,
		),
		getSortedTwoHopItems: vi.fn((items: readonly IndexedLink[]) => items),
		getSortedTagGroupItems: vi.fn((items: readonly TaggedNote[]) => items),
		priorityFrontmatterKeyForTitle: "title",
	};
}

describe("TwohopSearchAdapter.buildDataset", () => {
	const searchAdapter = createSearchAdapterHarness();

	it("builds snapshot from resolved outgoing branch with frontmatter title", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/outgoing-target.md");
		const displayData = createDisplayData({
			outgoing: [createBranch(sourceFile, targetFile.path, "Outgoing Raw")],
		});
		const options = createAdapterOptions(displayData, sourceFile);

		const snapshots = searchAdapter.buildDataset(options);
		const outgoingSnapshot = snapshots.find((s) => s.key.startsWith("o"));

		expect(outgoingSnapshot?.searchText).toContain("outgoing-target link");
		expect(outgoingSnapshot?.searchText).toContain("outgoing raw");
		expect(outgoingSnapshot?.targetFilePath).toBe(targetFile.path);
	});

	it("builds snapshots for merged branches and backlinks", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const mergedTarget = createMockTFile("notes/merged-target.md");
		const mergedBacklinkSource = createMockTFile("notes/merged-backlink.md");
		const displayData = createDisplayData({
			mergedItems: [
				createBranch(sourceFile, mergedTarget.path, "Merged Branch Raw"),
				createBacklink(mergedBacklinkSource, "Merged Backlink Raw"),
			],
		});
		const options = createAdapterOptions(displayData, sourceFile, {
			useMergedLinks: true,
			showTags: true,
		});

		const snapshots = searchAdapter.buildDataset(options);
		const mergedBranchSnapshot = snapshots.find(
			(s) => s.key.startsWith("m") && s.searchText.includes("merged branch raw"),
		);
		const mergedBacklinkSnapshot = snapshots.find(
			(s) =>
				s.key.startsWith("m") && s.searchText.includes("merged-backlink link"),
		);

		expect(mergedBranchSnapshot).toBeDefined();
		expect(mergedBranchSnapshot?.targetFilePath).toBe(mergedTarget.path);
		expect(mergedBacklinkSnapshot).toBeDefined();
		expect(mergedBacklinkSnapshot?.targetFilePath).toBe(mergedBacklinkSource.path);
	});

	it("builds snapshots for two-hop children", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/target.md");
		const childSource = createMockTFile("notes/child-source.md");
		const displayData = createDisplayData({
			twoHopBranches: [
				createBranch(sourceFile, targetFile.path, "Parent Raw", [
					createBacklink(childSource, "Child Raw"),
				]),
			],
		});
		const options = createAdapterOptions(displayData, sourceFile);

		const snapshots = searchAdapter.buildDataset(options);
		const childSnapshot = snapshots.find((s) => s.key.startsWith("h"));

		expect(childSnapshot?.searchText).toContain("child-source link");
		expect(childSnapshot?.targetFilePath).toBe(childSource.path);
	});

	it("builds tag section snapshot with tag name", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const taggedFile = createMockTFile("notes/tagged.md");
		const displayData = createDisplayData({
			tagGroups: [
				{
					tag: "alpha",
					notes: [createTaggedNote(taggedFile)],
				} satisfies TagGroup,
			],
		});
		const options = createAdapterOptions(displayData, sourceFile);

		const snapshots = searchAdapter.buildDataset(options);
		const tagGroupSnapshot = snapshots.find((s) => s.key.startsWith("g"));

		expect(tagGroupSnapshot?.searchText).toBe("#alpha");
		expect(tagGroupSnapshot?.targetFilePath).toBeNull();
	});

	it("builds nested snapshots in the same sorted order as their sections", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const parentFile = createMockTFile("notes/parent.md");
		const firstChild = createBacklink(
			createMockTFile("notes/first-child.md"),
			"First Child",
		);
		const secondChild = createBacklink(
			createMockTFile("notes/second-child.md"),
			"Second Child",
		);
		const firstNote = createTaggedNote(createMockTFile("notes/first-note.md"));
		const secondNote = createTaggedNote(createMockTFile("notes/second-note.md"));
		const displayData = createDisplayData({
			twoHopBranches: [
				createBranch(sourceFile, parentFile.path, "Parent", [
					firstChild,
					secondChild,
				]),
			],
			tagGroups: [
				{
					tag: "alpha",
					notes: [firstNote, secondNote],
				},
			],
		});
		const options = createAdapterOptions(displayData, sourceFile);
		options.getSortedTwoHopItems.mockImplementation((items) =>
			[...items].reverse(),
		);
		options.getSortedTagGroupItems.mockImplementation((items) =>
			[...items].reverse(),
		);

		const snapshots = searchAdapter.buildDataset(options);

		expect(
			snapshots.map((snapshot) => snapshot.targetFilePath ?? snapshot.searchText),
		).toEqual([
			secondChild.sourceFile.path,
			firstChild.sourceFile.path,
			"#alpha",
			secondNote.file.path,
			firstNote.file.path,
		]);
	});

	it("uses only the active primary link mode for snapshots", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const outgoingTarget = createMockTFile("notes/outgoing-target.md");
		const backlinkSource = createMockTFile("notes/backlink-source.md");
		const mergedTarget = createMockTFile("notes/merged-target.md");
		const displayData = createDisplayData({
			outgoing: [createBranch(sourceFile, outgoingTarget.path, "Outgoing Raw")],
			backlinks: [createBacklink(backlinkSource, "Backlink Raw")],
			mergedItems: [createBranch(sourceFile, mergedTarget.path, "Merged Raw")],
		});

		const separateSnapshots = searchAdapter.buildDataset(
			createAdapterOptions(displayData, sourceFile, {
				useMergedLinks: false,
				showTags: true,
			}),
		);
		const mergedSnapshots = searchAdapter.buildDataset(
			createAdapterOptions(displayData, sourceFile, {
				useMergedLinks: true,
				showTags: true,
			}),
		);

		expect(separateSnapshots.some((snapshot) => snapshot.key.startsWith("o"))).toBe(
			true,
		);
		expect(separateSnapshots.some((snapshot) => snapshot.key.startsWith("b"))).toBe(
			true,
		);
		expect(separateSnapshots.some((snapshot) => snapshot.key.startsWith("m"))).toBe(
			false,
		);
		expect(mergedSnapshots.some((snapshot) => snapshot.key.startsWith("o"))).toBe(
			false,
		);
		expect(mergedSnapshots.some((snapshot) => snapshot.key.startsWith("b"))).toBe(
			false,
		);
		expect(mergedSnapshots.some((snapshot) => snapshot.key.startsWith("m"))).toBe(
			true,
		);
	});

	it("omits tag snapshots when tags are hidden", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const taggedFile = createMockTFile("notes/tagged.md");
		const displayData = createDisplayData({
			tagGroups: [
				{
					tag: "alpha",
					notes: [createTaggedNote(taggedFile)],
				} satisfies TagGroup,
			],
		});

		const snapshots = searchAdapter.buildDataset(
			createAdapterOptions(displayData, sourceFile, {
				useMergedLinks: false,
				showTags: false,
			}),
		);

		expect(snapshots.some((snapshot) => snapshot.key.startsWith("g"))).toBe(false);
		expect(snapshots.some((snapshot) => snapshot.key.startsWith("n"))).toBe(false);
	});
});

describe("TwohopSearchAdapter incremental filtering", () => {
	const searchAdapter = createSearchAdapterHarness();

	it("returns empty sections when the committed result has no matches", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/target.md");
		const displayData = createDisplayData({
			outgoing: [createBranch(sourceFile, targetFile.path, "target")],
			backlinks: [createBacklink(targetFile, "backlink")],
		});

		const result = applyIncrementalMatches(
			createAdapterOptions(displayData, sourceFile),
			[],
		);

		expect(result.outgoing).toEqual([]);
		expect(result.backlinks).toEqual([]);
		expect(result.mergedItems).toEqual([]);
		expect(result.twoHopBranches).toEqual([]);
		expect(result.tagGroups).toEqual([]);
		expect(result.newLinks).toEqual([]);
	});

	it("hides twohop branch when only parent matches", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/parent.md");
		const alphaChild = createMockTFile("notes/alpha-child.md");
		const betaChild = createMockTFile("notes/beta-child.md");
		const branch = createBranch(sourceFile, targetFile.path, "needle-parent", [
			createBacklink(alphaChild, "alpha-child"),
			createBacklink(betaChild, "beta-child"),
		]);
		const displayData = createDisplayData({
			outgoing: [branch],
			twoHopBranches: [branch],
		});
		const options = createAdapterOptions(displayData, sourceFile);
		const snapshots = searchAdapter.buildDataset(options);
		const parentSnapshot = snapshots.find((snapshot) =>
			snapshot.key.startsWith("o"),
		);
		expect(parentSnapshot).toBeDefined();
		if (!parentSnapshot) return;

		const result = applyIncrementalMatches(options, [parentSnapshot.key]);

		expect(result.outgoing).toEqual([branch]);
		expect(result.twoHopBranches).toHaveLength(0);
	});

	it("keeps twohop branch with only matched children when child matches", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/parent.md");
		const alphaChild = createMockTFile("notes/alpha-child.md");
		const betaChild = createMockTFile("notes/beta-child.md");
		const displayData = createDisplayData({
			twoHopBranches: [
				createBranch(sourceFile, targetFile.path, "parent", [
					createBacklink(alphaChild, "alpha-child"),
					createBacklink(betaChild, "beta-child"),
				]),
			],
		});
		const options = createAdapterOptions(displayData, sourceFile);
		const snapshots = searchAdapter.buildDataset(options);
		const betaChildKey = snapshots.find((s) => s.key.includes("beta-child"))?.key;

		const result = applyIncrementalMatches(options, [betaChildKey ?? ""]);

		expect(result.twoHopBranches).toHaveLength(1);
		expect(result.twoHopBranches[0].hop2).toHaveLength(1);
	});

	it("keeps tag section and notes when tag section name matches", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const noteFile = createMockTFile("notes/note.md");
		const displayData = createDisplayData({
			tagGroups: [
				{
					tag: "alpha",
					notes: [createTaggedNote(noteFile)],
				} satisfies TagGroup,
			],
		});
		const options = createAdapterOptions(displayData, sourceFile);
		const snapshots = searchAdapter.buildDataset(options);
		const tagGroupKey = snapshots.find((s) => s.key.startsWith("g"))?.key;

		const result = applyIncrementalMatches(options, [tagGroupKey ?? ""]);

		expect(result.tagGroups).toHaveLength(1);
		expect(result.tagGroups[0].notes).toHaveLength(1);
	});

	it("keeps tag section with only matched notes when tag note matches", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const alphaNote = createMockTFile("notes/alpha-note.md");
		const betaNote = createMockTFile("notes/beta-note.md");
		const displayData = createDisplayData({
			tagGroups: [
				{
					tag: "section",
					notes: [
						createTaggedNote(alphaNote, "section"),
						createTaggedNote(betaNote, "section"),
					],
				} satisfies TagGroup,
			],
		});
		const options = createAdapterOptions(displayData, sourceFile);
		const snapshots = searchAdapter.buildDataset(options);
		const betaNoteKey = snapshots.find((s) => s.key.includes("beta-note"))?.key;

		const result = applyIncrementalMatches(options, [betaNoteKey ?? ""]);

		expect(result.tagGroups).toHaveLength(1);
		expect(result.tagGroups[0].notes).toHaveLength(1);
	});

	it("hides newLinks when query is active", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const displayData = createDisplayData({
			newLinks: [
				{
					sourceFile,
					rawText: "new-link",
					path: undefined,
					isUnresolved: true,
					backlinkCount: 0,
				} as IndexedLink,
			],
		});

		const result = applyIncrementalMatches(
			createAdapterOptions(displayData, sourceFile),
			[],
		);

		expect(result.newLinks).toEqual([]);
	});

	it("filters only the active primary link mode", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const outgoingTarget = createMockTFile("notes/outgoing-target.md");
		const backlinkSource = createMockTFile("notes/backlink-source.md");
		const mergedTarget = createMockTFile("notes/merged-target.md");
		const mergedBranch = createBranch(sourceFile, mergedTarget.path, "Merged Raw");
		const displayData = createDisplayData({
			outgoing: [createBranch(sourceFile, outgoingTarget.path, "Outgoing Raw")],
			backlinks: [createBacklink(backlinkSource, "Backlink Raw")],
			mergedItems: [mergedBranch],
		});
		const options = createAdapterOptions(displayData, sourceFile, {
			useMergedLinks: true,
			showTags: true,
		});
		const mergedKey = searchAdapter
			.buildDataset(options)
			.find((snapshot) => snapshot.key.startsWith("m"))?.key;

		const result = applyIncrementalMatches(options, [mergedKey ?? ""]);

		expect(result.outgoing).toEqual([]);
		expect(result.backlinks).toEqual([]);
		expect(result.mergedItems).toEqual([mergedBranch]);
	});

	it("filters out tag groups when tags are hidden", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const noteFile = createMockTFile("notes/note.md");
		const displayData = createDisplayData({
			tagGroups: [
				{
					tag: "alpha",
					notes: [createTaggedNote(noteFile)],
				} satisfies TagGroup,
			],
		});
		const options = createAdapterOptions(displayData, sourceFile, {
			useMergedLinks: false,
			showTags: false,
		});
		const tagGroupKey = searchAdapter
			.buildDataset(options)
			.find((snapshot) => snapshot.key.startsWith("g"))?.key;

		const result = applyIncrementalMatches(options, [tagGroupKey ?? ""]);

		expect(result.tagGroups).toEqual([]);
	});
});

describe("TwohopSearchAdapter.buildSnapshot", () => {
	it("builds search items and unique files in one snapshot", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const repeatedFile = createMockTFile("notes/repeated.md");
		const displayData = createDisplayData({
			backlinks: [
				createBacklink(repeatedFile, "First backlink"),
				createBacklink(repeatedFile, "Second backlink"),
			],
			tagGroups: [
				{
					tag: "alpha",
					notes: [createTaggedNote(repeatedFile)],
				} satisfies TagGroup,
			],
		});
		const options = createAdapterOptions(displayData, sourceFile);
		const adapter = createSearchAdapterHarness();

		const snapshot = adapter.buildSnapshot(options);
		expect(snapshot.searchableFiles).toEqual([repeatedFile]);
		expect(snapshot.items).toHaveLength(4);
		expect(options.fileToLinktext).toHaveBeenCalledTimes(1);
		expect(options.getMetadata).toHaveBeenCalledTimes(1);
	});
});

describe("TwohopSearchAdapter searchable files", () => {
	it("collects files represented by search items in active sections", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const outgoingTarget = createMockTFile("notes/outgoing-target.md");
		const backlinkSource = createMockTFile("notes/backlink-source.md");
		const mergedTarget = createMockTFile("notes/merged-target.md");
		const mergedBacklinkSource = createMockTFile("notes/merged-backlink.md");
		const twoHopParentTarget = createMockTFile("notes/twohop-parent.md");
		const childSource = createMockTFile("notes/child-source.md");
		const taggedFile = createMockTFile("notes/tagged.md");

		const displayData: DisplayData = {
			outgoing: [createBranch(sourceFile, outgoingTarget.path, "Outgoing Raw")],
			backlinks: [createBacklink(backlinkSource, "Backlink Raw")],
			mergedItems: [
				createBranch(sourceFile, mergedTarget.path, "Merged Branch Raw"),
				createBacklink(mergedBacklinkSource, "Merged Backlink Raw"),
			],
			twoHopBranches: [
				createBranch(sourceFile, twoHopParentTarget.path, "Parent Raw", [
					createBacklink(childSource, "Child Raw"),
				]),
			],
			tagGroups: [
				{
					tag: "alpha",
					notes: [createTaggedNote(taggedFile)],
				} satisfies TagGroup,
			],
			newLinks: [],
		};
		const options = createAdapterOptions(displayData, sourceFile);

		const files = buildTwoHopSearchSnapshot(options).searchableFiles;
		const filePaths = files.map((f) => f.path);

		expect(filePaths).toEqual(
			expect.arrayContaining([
				outgoingTarget.path,
				backlinkSource.path,
				childSource.path,
				taggedFile.path,
			]),
		);
		expect(filePaths).not.toContain(twoHopParentTarget.path);
		expect(filePaths).not.toContain(mergedTarget.path);
		expect(filePaths).not.toContain(mergedBacklinkSource.path);
	});

	it("collects merged and omits tag files when those sections are active", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const outgoingTarget = createMockTFile("notes/outgoing-target.md");
		const backlinkSource = createMockTFile("notes/backlink-source.md");
		const mergedTarget = createMockTFile("notes/merged-target.md");
		const mergedBacklinkSource = createMockTFile("notes/merged-backlink.md");
		const taggedFile = createMockTFile("notes/tagged.md");
		const displayData: DisplayData = {
			outgoing: [createBranch(sourceFile, outgoingTarget.path, "Outgoing Raw")],
			backlinks: [createBacklink(backlinkSource, "Backlink Raw")],
			mergedItems: [
				createBranch(sourceFile, mergedTarget.path, "Merged Branch Raw"),
				createBacklink(mergedBacklinkSource, "Merged Backlink Raw"),
			],
			twoHopBranches: [],
			tagGroups: [
				{
					tag: "alpha",
					notes: [createTaggedNote(taggedFile)],
				} satisfies TagGroup,
			],
			newLinks: [],
		};
		const options = createAdapterOptions(displayData, sourceFile, {
			useMergedLinks: true,
			showTags: false,
		});

		const files = buildTwoHopSearchSnapshot(options).searchableFiles;
		const filePaths = files.map((f) => f.path);

		expect(filePaths).toEqual(
			expect.arrayContaining([mergedTarget.path, mergedBacklinkSource.path]),
		);
		expect(filePaths).not.toContain(outgoingTarget.path);
		expect(filePaths).not.toContain(backlinkSource.path);
		expect(filePaths).not.toContain(taggedFile.path);
	});
});

describe("TwohopSearchAdapter incremental publication", () => {
	it("appends nested matches in search order without mutating earlier snapshots", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const parentFile = createMockTFile("notes/parent.md");
		const firstChild = createBacklink(
			createMockTFile("notes/first-child.md"),
			"First Child",
		);
		const secondChild = createBacklink(
			createMockTFile("notes/second-child.md"),
			"Second Child",
		);
		const branch = createBranch(sourceFile, parentFile.path, "Parent", [
			firstChild,
			secondChild,
		]);
		const displayData = createDisplayData({ twoHopBranches: [branch] });
		const options = createAdapterOptions(displayData, sourceFile);
		options.getSortedTwoHopItems.mockImplementation((items) =>
			[...items].reverse(),
		);
		const searchSnapshot = buildTwoHopSearchSnapshot(options);
		const childMatches = searchSnapshot.items.map(
			(item): SearchMatchedItem => ({
				key: item.key,
				contentMatched: false,
			}),
		);
		const filter = searchSnapshot.createIncrementalFilter();

		const firstSnapshot = filter.append([childMatches[0]]);
		const secondSnapshot = filter.append([childMatches[1]]);

		expect(
			firstSnapshot.twoHopBranches[0].hop2.map((link) => link.sourceFile.path),
		).toEqual([secondChild.sourceFile.path]);
		expect(
			secondSnapshot.twoHopBranches[0].hop2.map((link) => link.sourceFile.path),
		).toEqual([secondChild.sourceFile.path, firstChild.sourceFile.path]);
	});
});
