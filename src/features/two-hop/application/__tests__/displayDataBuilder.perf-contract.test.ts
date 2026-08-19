import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { DEFAULT_SETTINGS } from "features/settings/model";
import * as grouping from "core/grouping";
import type { ISortService, SortableItem, SortOption } from "core/sorting";
import type {
	TaggedNote,
	TwoHopIndexedLink,
	TwoHopLinkBranch,
	TwoHopLinkResult,
} from "types/domain";
import {
	createDisplayDataBuilder,
	type DisplayData,
	type PreprocessedDisplayData,
} from "../displayDataBuilder";
import type { PluginSettings } from "features/settings/model";

const defaultSettings: PluginSettings = DEFAULT_SETTINGS;

function getSortableItemLabel(item: SortableItem): string {
	if ("hop1" in item) return item.hop1.rawText;
	if ("file" in item) return item.file.basename;
	if ("rawText" in item) return item.rawText;
	return item.path;
}

interface SortServiceProbe {
	readonly service: ISortService;
	readonly sort: ReturnType<typeof vi.spyOn>;
}

function createSortService(
	compare: (left: SortableItem, right: SortableItem) => number,
): SortServiceProbe {
	const service: ISortService = {
		sort: <T extends SortableItem>(
			items: readonly T[],
			option: SortOption,
		): readonly T[] => {
			const copy = [...items].sort((left, right) => compare(left, right));
			if (option.endsWith("reverse")) copy.reverse();
			return copy.every((item, index) => item === items[index]) ? items : copy;
		},
	};
	return { service, sort: vi.spyOn(service, "sort") };
}

function createReorderingSortService(): SortServiceProbe {
	return createSortService((left, right) =>
		getSortableItemLabel(left).localeCompare(getSortableItemLabel(right)),
	);
}

function createIdentitySortService(): SortServiceProbe {
	return createSortService(() => 0);
}

function preprocessDisplayData(
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
): PreprocessedDisplayData {
	const builder = createDisplayDataBuilder({
		sortService: createReorderingSortService().service,
	});
	const linkResultData = builder.preprocessLinkDisplayData(linkResult, settings);
	const tagPreprocessed = builder.preprocessTagDisplayData(
		linkResult,
		settings,
		linkResultData.state,
	);
	return { ...linkResultData.data, ...tagPreprocessed };
}

function createBranch(rawText: string, path: string): TwoHopLinkBranch {
	return {
		hop1: {
			rawText,
			path,
			isUnresolved: false,
			sourceFile: createMockTFile("origin.md"),
		},
		hop2: [],
	};
}

function createUnresolvedBranch(rawText: string): TwoHopLinkBranch {
	return {
		hop1: {
			rawText,
			path: undefined,
			isUnresolved: true,
			sourceFile: createMockTFile("origin.md"),
			backlinkCount: 1,
		},
		hop2: [],
	};
}

function createBacklink(rawText: string): TwoHopIndexedLink {
	return {
		rawText,
		path: `${rawText}.md`,
		isUnresolved: false,
		sourceFile: createMockTFile(`${rawText}-source.md`),
	};
}

function createLinkResult(
	branches: readonly TwoHopLinkBranch[],
	taggedNotes: readonly TaggedNote[] = [],
	backlinks: readonly TwoHopIndexedLink[] = [],
): TwoHopLinkResult {
	return {
		originFile: createMockTFile("origin.md"),
		branches,
		backlinks,
		taggedNotes,
	};
}

function createDisplayData(
	builder: ReturnType<typeof createDisplayDataBuilder>,
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
): DisplayData {
	const linkResultData = builder.preprocessLinkDisplayData(linkResult, settings);
	const tagPreprocessed = builder.preprocessTagDisplayData(
		linkResult,
		settings,
		linkResultData.state,
	);
	return builder.sortAndAssembleDisplayData(
		{ ...linkResultData.data, ...tagPreprocessed },
		settings,
		"alphabetical",
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("DisplayDataBuilder performance contracts", () => {
	it("does not sort single-element display arrays", () => {
		const sortService = createIdentitySortService();
		const builder = createDisplayDataBuilder({ sortService: sortService.service });
		const linkResult = createLinkResult([createBranch("outgoing", "outgoing.md")]);

		createDisplayData(builder, linkResult, defaultSettings);

		expect(sortService.sort).not.toHaveBeenCalled();
	});

	it("reuses the assembled display for the same preprocessed snapshot", () => {
		const sortService = createReorderingSortService();
		const builder = createDisplayDataBuilder({ sortService: sortService.service });
		const preprocessed = preprocessDisplayData(undefined, defaultSettings);

		const first = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);
		const second = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);

		expect(second).toBe(first);
	});

	it.each([
		["separated", false, 3],
		["merged", true, 2],
	] as const)(
		"shares sort results across distinct preprocessed objects in %s mode",
		(_mode, useMergedLinksSection, expectedSortCalls) => {
			const settings = {
				...defaultSettings,
				dedupeCards: false,
				useMergedLinksSection,
				showTagsSection: false,
			};
			const sortService = createReorderingSortService();
			const builder = createDisplayDataBuilder({
				sortService: sortService.service,
			});
			const preprocessed = preprocessDisplayData(
				createLinkResult(
					[
						createBranch("branch-b", "branch-b.md"),
						createBranch("branch-a", "branch-a.md"),
						createUnresolvedBranch("new-b"),
						createUnresolvedBranch("new-a"),
					],
					[],
					[createBacklink("backlink-b"), createBacklink("backlink-a")],
				),
				settings,
			);
			const sameArraysPreprocessed = { ...preprocessed };

			const first = builder.sortAndAssembleDisplayData(
				preprocessed,
				settings,
				"alphabetical",
			);
			const second = builder.sortAndAssembleDisplayData(
				sameArraysPreprocessed,
				settings,
				"alphabetical",
			);

			expect(second).not.toBe(first);
			expect(second.newLinks).toBe(first.newLinks);
			if (useMergedLinksSection) {
				expect(second.mergedItems).toBe(first.mergedItems);
			} else {
				expect(second.outgoing).toBe(first.outgoing);
				expect(second.backlinks).toBe(first.backlinks);
			}
			expect(sortService.sort).toHaveBeenCalledTimes(expectedSortCalls);
		},
	);

	it("invalidates assembly and sort caches when the sort context changes", () => {
		let sortContextVersion = 1;
		const sortService = createReorderingSortService();
		const builder = createDisplayDataBuilder({
			sortService: sortService.service,
			getSortContextVersion: () => sortContextVersion,
		});
		const preprocessed = preprocessDisplayData(
			createLinkResult([
				createBranch("zeta", "zeta.md"),
				createBranch("alpha", "alpha.md"),
			]),
			defaultSettings,
		);

		const first = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);
		const second = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);
		expect(second).toBe(first);

		sortContextVersion = 2;
		const third = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);

		expect(third).not.toBe(first);
		expect(sortService.sort.mock.calls.length).toBeGreaterThan(1);
	});

	it("regenerates tag-item sort results after the sort context changes", () => {
		let sortContextVersion = 1;
		const sortService = createReorderingSortService();
		const builder = createDisplayDataBuilder({
			sortService: sortService.service,
			getSortContextVersion: () => sortContextVersion,
		});
		const taggedNotes: TaggedNote[] = [
			{
				file: createMockTFile("zeta.md"),
				commonTags: ["#tag"],
				path: "zeta.md",
			},
			{
				file: createMockTFile("alpha.md"),
				commonTags: ["#tag"],
				path: "alpha.md",
			},
		];

		const first = builder.getSortedTagGroupItems(taggedNotes, "alphabetical");
		const second = builder.getSortedTagGroupItems(taggedNotes, "alphabetical");
		expect(second).toBe(first);

		sortContextVersion = 2;
		const third = builder.getSortedTagGroupItems(taggedNotes, "alphabetical");

		expect(third).not.toBe(first);
		expect(sortService.sort.mock.calls.length).toBe(2);
	});

	it("reuses a sorted two-hop array by reference", () => {
		const sortService = createReorderingSortService();
		const builder = createDisplayDataBuilder({ sortService: sortService.service });
		const items: TwoHopIndexedLink[] = [
			{
				rawText: "hop2-b",
				path: "hop2-b.md",
				isUnresolved: false,
				sourceFile: createMockTFile("source-b.md"),
			},
			{
				rawText: "hop2-a",
				path: "hop2-a.md",
				isUnresolved: false,
				sourceFile: createMockTFile("source-a.md"),
			},
		];

		const first = builder.getSortedTwoHopItems(items, "alphabetical");
		const second = builder.getSortedTwoHopItems(items, "alphabetical");

		expect(second).toBe(first);
		expect(sortService.sort).toHaveBeenCalledTimes(1);
	});

	it("invalidates direct two-hop sort results when the sort context changes", () => {
		let sortContextVersion = 1;
		const sortService = createReorderingSortService();
		const builder = createDisplayDataBuilder({
			sortService: sortService.service,
			getSortContextVersion: () => sortContextVersion,
		});
		const items: TwoHopIndexedLink[] = [
			{
				rawText: "hop2-b",
				path: "hop2-b.md",
				isUnresolved: false,
				sourceFile: createMockTFile("source-b.md"),
			},
			{
				rawText: "hop2-a",
				path: "hop2-a.md",
				isUnresolved: false,
				sourceFile: createMockTFile("source-a.md"),
			},
		];

		const first = builder.getSortedTwoHopItems(items, "alphabetical");
		sortContextVersion = 2;
		const second = builder.getSortedTwoHopItems(items, "alphabetical");

		expect(second).not.toBe(first);
		expect(sortService.sort).toHaveBeenCalledTimes(2);
	});

	it("reuses the original two-hop branch when its order is unchanged", () => {
		const branch: TwoHopLinkBranch = {
			hop1: {
				rawText: "hop1",
				path: "hop1.md",
				isUnresolved: false,
				sourceFile: createMockTFile("origin.md"),
			},
			hop2: [
				{
					rawText: "alpha",
					path: "alpha.md",
					isUnresolved: false,
					sourceFile: createMockTFile("alpha.md"),
				},
				{
					rawText: "beta",
					path: "beta.md",
					isUnresolved: false,
					sourceFile: createMockTFile("beta.md"),
				},
			],
		};
		const builder = createDisplayDataBuilder({
			sortService: createIdentitySortService().service,
		});

		const result = createDisplayData(builder, createLinkResult([branch]), {
			...defaultSettings,
			dedupeCards: false,
		});

		expect(result.twoHopBranches[0]).toBe(branch);
		expect(result.twoHopBranches[0]?.hop2).toBe(branch.hop2);
	});

	it("returns a new two-hop array when sorting changes its order", () => {
		const items: TwoHopIndexedLink[] = [
			{
				rawText: "zeta",
				path: "zeta.md",
				isUnresolved: false,
				sourceFile: createMockTFile("zeta.md"),
			},
			{
				rawText: "alpha",
				path: "alpha.md",
				isUnresolved: false,
				sourceFile: createMockTFile("alpha.md"),
			},
		];
		const builder = createDisplayDataBuilder({
			sortService: createReorderingSortService().service,
		});

		const result = builder.getSortedTwoHopItems(items, "alphabetical");

		expect(result).not.toBe(items);
		expect(result.map((item) => item.rawText)).toEqual(["alpha", "zeta"]);
	});

	it.each([
		["useMergedLinksSection", { useMergedLinksSection: true }],
		["showTagsSection", { showTagsSection: false }],
	] as const)("invalidates the %s assembly dependency", (_key, override) => {
		const builder = createDisplayDataBuilder({
			sortService: createIdentitySortService().service,
		});
		const preprocessed = preprocessDisplayData(undefined, defaultSettings);
		const first = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);
		const second = builder.sortAndAssembleDisplayData(
			preprocessed,
			{ ...defaultSettings, ...override },
			"alphabetical",
		);
		const firstAgain = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);

		expect(second).not.toBe(first);
		expect(firstAgain).toBe(first);
	});

	it("does not reuse assembled data after the sort context changes", () => {
		let sortContextVersion = 1;
		const builder = createDisplayDataBuilder({
			sortService: createIdentitySortService().service,
			getSortContextVersion: () => sortContextVersion,
		});
		const preprocessed = preprocessDisplayData(undefined, defaultSettings);
		const first = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);

		sortContextVersion = 2;
		const second = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);

		expect(second).not.toBe(first);
	});

	it("groups tags once across an A -> B -> A display revisit", () => {
		const groupNotesByTagSpy = vi.spyOn(grouping, "groupNotesByTag");
		const builder = createDisplayDataBuilder({
			sortService: createReorderingSortService().service,
		});
		const preprocessed = preprocessDisplayData(
			createLinkResult(
				[
					createBranch("branch-b", "branch-b.md"),
					createBranch("branch-a", "branch-a.md"),
				],
				[
					{
						file: createMockTFile("tagged-b.md"),
						commonTags: ["#tag"],
						path: "tagged-b.md",
					},
					{
						file: createMockTFile("tagged-a.md"),
						commonTags: ["#tag"],
						path: "tagged-a.md",
					},
				],
			),
			defaultSettings,
		);
		const first = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);
		builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical-reverse",
		);
		const firstAgain = builder.sortAndAssembleDisplayData(
			preprocessed,
			defaultSettings,
			"alphabetical",
		);

		expect(firstAgain).toBe(first);
		expect(groupNotesByTagSpy).toHaveBeenCalledTimes(1);
	});
});
