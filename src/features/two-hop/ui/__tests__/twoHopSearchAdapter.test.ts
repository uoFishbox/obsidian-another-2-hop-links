import { describe, expect, it, vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { TFile } from "obsidian";
import type {
	TagGroup,
	TaggedNote,
	TwoHopIndexedLink,
	TwoHopLinkBranch,
} from "types/domain";
import type { SearchWorkerMatchedItem } from "features/search/searchWorkerTypes";
import type { DisplayData } from "features/two-hop/application/displayDataBuilder";
import {
	createTwohopSearchAdapter,
	type TwohopSearchAdapterOptions,
	type TwohopSearchRenderMode,
} from "features/two-hop/ui/twoHopSearchAdapter";

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
	const adapter = createTwohopSearchAdapter();
	return {
		...adapter,
		buildDataset: (options: TwohopSearchAdapterOptions) =>
			adapter.buildSnapshot(options).workerItems,
	};
}

function createBacklink(sourceFile: TFile, rawText: string): TwoHopIndexedLink {
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
	hop2: TwoHopIndexedLink[] = [],
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

function createMatchesByKey(
	keys: Iterable<string>,
): Map<string, SearchWorkerMatchedItem> {
	const matchesByKey = new Map<string, SearchWorkerMatchedItem>();
	for (const key of keys) {
		matchesByKey.set(key, {
			key,
			contentMatched: false,
		});
	}
	return matchesByKey;
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

describe("TwohopSearchAdapter.filterDisplayData", () => {
	const searchAdapter = createSearchAdapterHarness();

	it("returns original displayData when query is empty", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/target.md");
		const displayData = createDisplayData({
			outgoing: [createBranch(sourceFile, targetFile.path, "target")],
		});

		const result = searchAdapter.filterDisplayData(
			displayData,
			"",
			createMatchesByKey([]),
			DEFAULT_RENDER_MODE,
		);

		expect(result).toBe(displayData);
	});

	it("returns empty sections when matchesByKey is null", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/target.md");
		const displayData = createDisplayData({
			outgoing: [createBranch(sourceFile, targetFile.path, "target")],
			backlinks: [createBacklink(targetFile, "backlink")],
		});

		const result = searchAdapter.filterDisplayData(
			displayData,
			"query",
			null,
			DEFAULT_RENDER_MODE,
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
		const childFile = createMockTFile("notes/child.md");
		const displayData = createDisplayData({
			twoHopBranches: [
				createBranch(sourceFile, targetFile.path, "parent", [
					createBacklink(childFile, "child"),
				]),
			],
		});
		const options = createAdapterOptions(displayData, sourceFile);
		const snapshots = searchAdapter.buildDataset(options);
		const parentKey = snapshots.find((s) => !s.key.startsWith("h"))?.key;

		const result = searchAdapter.filterDisplayData(
			displayData,
			"query",
			createMatchesByKey([parentKey ?? ""]),
			DEFAULT_RENDER_MODE,
		);

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

		const result = searchAdapter.filterDisplayData(
			displayData,
			"query",
			createMatchesByKey([betaChildKey ?? ""]),
			DEFAULT_RENDER_MODE,
		);

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

		const result = searchAdapter.filterDisplayData(
			displayData,
			"query",
			createMatchesByKey([tagGroupKey ?? ""]),
			DEFAULT_RENDER_MODE,
		);

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

		const result = searchAdapter.filterDisplayData(
			displayData,
			"query",
			createMatchesByKey([betaNoteKey ?? ""]),
			DEFAULT_RENDER_MODE,
		);

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
				} as TwoHopIndexedLink,
			],
		});

		const result = searchAdapter.filterDisplayData(
			displayData,
			"query",
			createMatchesByKey([]),
			DEFAULT_RENDER_MODE,
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

		const result = searchAdapter.filterDisplayData(
			displayData,
			"query",
			createMatchesByKey([mergedKey ?? ""]),
			{
				useMergedLinks: true,
				showTags: true,
			},
		);

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
		const options = createAdapterOptions(displayData, sourceFile);
		const tagGroupKey = searchAdapter
			.buildDataset(options)
			.find((snapshot) => snapshot.key.startsWith("g"))?.key;

		const result = searchAdapter.filterDisplayData(
			displayData,
			"query",
			createMatchesByKey([tagGroupKey ?? ""]),
			{
				useMergedLinks: false,
				showTags: false,
			},
		);

		expect(result.tagGroups).toEqual([]);
	});
});

describe("TwohopSearchAdapter.buildSnapshot", () => {
	it("builds worker items and unique files in one snapshot", () => {
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
		expect(snapshot.workerItems).toHaveLength(4);
		expect(options.fileToLinktext).toHaveBeenCalledTimes(1);
		expect(options.getMetadata).toHaveBeenCalledTimes(1);
	});
});

describe("TwohopSearchAdapter searchable files", () => {
	it("collects files from visible sections", () => {
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

		const files =
			createTwohopSearchAdapter().buildSnapshot(options).searchableFiles;
		const filePaths = files.map((f) => f.path);

		expect(filePaths).toEqual(
			expect.arrayContaining([
				outgoingTarget.path,
				backlinkSource.path,
				twoHopParentTarget.path,
				childSource.path,
				taggedFile.path,
			]),
		);
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

		const files =
			createTwohopSearchAdapter().buildSnapshot(options).searchableFiles;
		const filePaths = files.map((f) => f.path);

		expect(filePaths).toEqual(
			expect.arrayContaining([mergedTarget.path, mergedBacklinkSource.path]),
		);
		expect(filePaths).not.toContain(outgoingTarget.path);
		expect(filePaths).not.toContain(backlinkSource.path);
		expect(filePaths).not.toContain(taggedFile.path);
	});
});
