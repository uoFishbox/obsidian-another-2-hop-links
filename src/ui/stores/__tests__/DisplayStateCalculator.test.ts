import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type {
	DisplayDataBuilder,
	LinkPreprocessedDisplayData,
	TagPreprocessedDisplayData,
} from "features/two-hop/application/displayDataBuilder";
import { createDedupState } from "core/deduplication/usageTracker";
import type { DedupState } from "types/deduplication";
import type { TaggedNote, TwoHopIndexedLink, TwoHopLinkResult } from "types/domain";
import { DEFAULT_SETTINGS, type PluginSettings } from "features/settings/model";
import {
	computePreprocessedDisplayDataState,
	createPreprocessedDisplayDataCache,
} from "ui/stores/application/DisplayStateCalculator";

function createBacklink(path: string): TwoHopIndexedLink {
	return {
		rawText: path,
		path,
		isUnresolved: false,
		sourceFile: createMockTFile(path),
	};
}

function createTaggedNote(path: string): TaggedNote {
	return {
		file: createMockTFile(path),
		commonTags: ["#tag"],
		path,
	};
}

function createLinkResult(
	backlinks: TwoHopIndexedLink[],
	taggedNotes: TaggedNote[],
): TwoHopLinkResult {
	return {
		originFile: createMockTFile("origin.md"),
		branches: [],
		backlinks,
		taggedNotes,
	};
}

function createFullDedupeBuilder() {
	const preprocessLinkDisplayData = vi.fn(
		(linkResult: TwoHopLinkResult | undefined) => {
			const resolvedBacklinks = linkResult?.backlinks ?? [];
			return {
				state: {
					usedKeys: new Set(
						resolvedBacklinks.map(
							(backlink) => `f:${backlink.sourceFile.path.toLowerCase()}`,
						),
					),
				},
				data: {
					resolvedBranches: [],
					resolvedBacklinks,
					mergedBaseItems: [...resolvedBacklinks],
					twoHopBranches: [],
					nonEmptyTwoHopBranches: [],
					newLinks: [],
				},
			};
		},
	);
	const preprocessTagDisplayData = vi.fn(
		(
			linkResult: TwoHopLinkResult | undefined,
			settings: PluginSettings,
			initialState: DedupState,
		) => {
			const taggedNotes =
				settings.showTagsSection && linkResult
					? linkResult.taggedNotes.filter(
							(note) =>
								!initialState.usedKeys.has(
									`f:${note.path.toLowerCase()}`,
								),
						)
					: [];
			return {
				taggedNotes,
				rawTagGroups: taggedNotes.length
					? [{ tag: "#tag", notes: taggedNotes }]
					: [],
			};
		},
	);

	const builder: DisplayDataBuilder = {
		preprocessLinkDisplayData,
		preprocessTagDisplayData,
		sortAndAssembleDisplayData: vi.fn(),
		getSortedTwoHopItems: vi.fn((items) => items),
		getSortedTagGroupItems: vi.fn((items) => items),
		getSortContextVersion: vi.fn(() => 0),
	};

	return {
		builder,
		preprocessLinkDisplayData,
		preprocessTagDisplayData,
	};
}

const PREPROCESS_DEPENDENCY_SETTING_OVERRIDES = {
	excludeAttachments: { excludeAttachments: true },
	twoHopHeaderSortOrder: { twoHopHeaderSortOrder: "hop2-count-asc" },
	dedupeCards: { dedupeCards: false },
	tagFeaturesEnabled: { enableTagFeatures: false },
	showTagsSection: { showTagsSection: false },
} satisfies Record<
	| "excludeAttachments"
	| "twoHopHeaderSortOrder"
	| "dedupeCards"
	| "tagFeaturesEnabled"
	| "showTagsSection",
	Partial<PluginSettings>
>;
const PREPROCESS_SETTING_KEYS = [
	"excludeAttachments",
	"twoHopHeaderSortOrder",
	"dedupeCards",
	"tagFeaturesEnabled",
	"showTagsSection",
] as const;

function createCacheProbeBuilder() {
	const preprocessLinkDisplayData = vi.fn(
		(_linkResult: TwoHopLinkResult | undefined, _settings: PluginSettings) => ({
			state: createDedupState(),
			data: {
				resolvedBranches: [],
				resolvedBacklinks: [],
				mergedBaseItems: [],
				twoHopBranches: [],
				nonEmptyTwoHopBranches: [],
				newLinks: [],
			} satisfies LinkPreprocessedDisplayData,
		}),
	);
	const preprocessTagDisplayData = vi.fn(
		(
			_linkResult: TwoHopLinkResult | undefined,
			_settings: PluginSettings,
		): TagPreprocessedDisplayData => ({
			taggedNotes: [],
			rawTagGroups: [],
		}),
	);
	const builder: DisplayDataBuilder = {
		preprocessLinkDisplayData,
		preprocessTagDisplayData,
		sortAndAssembleDisplayData: vi.fn(),
		getSortedTwoHopItems: vi.fn((items) => items),
		getSortedTagGroupItems: vi.fn((items) => items),
		getSortContextVersion: vi.fn(() => 0),
	};

	return {
		builder,
		preprocessLinkDisplayData,
		preprocessTagDisplayData,
	};
}

describe("DisplayStateCalculator", () => {
	it.each([
		{
			dedupeCards: false,
			inactiveReason: "tags hidden",
			inactiveTagSetting: { showTagsSection: false },
		},
		{
			dedupeCards: true,
			inactiveReason: "tags hidden",
			inactiveTagSetting: { showTagsSection: false },
		},
		{
			dedupeCards: false,
			inactiveReason: "tag features disabled",
			inactiveTagSetting: { enableTagFeatures: false },
		},
		{
			dedupeCards: true,
			inactiveReason: "tag features disabled",
			inactiveTagSetting: { enableTagFeatures: false },
		},
	])(
		"ignores taggedNotes identity with dedupeCards=$dedupeCards when $inactiveReason",
		({ dedupeCards, inactiveTagSetting }) => {
			const { builder, preprocessLinkDisplayData, preprocessTagDisplayData } =
				createCacheProbeBuilder();
			const cache = createPreprocessedDisplayDataCache();
			const settings = {
				...DEFAULT_SETTINGS,
				dedupeCards,
				...inactiveTagSetting,
			};
			const firstResult = createLinkResult([], []);
			const first = computePreprocessedDisplayDataState(
				builder,
				firstResult,
				settings,
				cache,
			);

			const second = computePreprocessedDisplayDataState(
				builder,
				{
					...firstResult,
					taggedNotes: [createTaggedNote("new-tagged-note.md")],
				},
				settings,
				cache,
			);

			expect(second).toBe(first);
			expect(preprocessLinkDisplayData).toHaveBeenCalledTimes(1);
			expect(preprocessTagDisplayData).toHaveBeenCalledTimes(1);
		},
	);

	it("reuses link preprocessing for a tag-only update with dedupe enabled", () => {
		const { builder, preprocessLinkDisplayData, preprocessTagDisplayData } =
			createFullDedupeBuilder();
		const backlinks = [createBacklink("shared.md")];
		const cache = createPreprocessedDisplayDataCache();
		const settings = {
			...DEFAULT_SETTINGS,
			dedupeCards: true,
			showTagsSection: true,
		};
		const linkResult = createLinkResult(backlinks, [createTaggedNote("shared.md")]);

		const first = computePreprocessedDisplayDataState(
			builder,
			linkResult,
			settings,
			cache,
		);
		expect(first.preprocessed?.resolvedBacklinks).toHaveLength(1);
		expect(first.preprocessed?.taggedNotes).toHaveLength(0);

		const cached = computePreprocessedDisplayDataState(
			builder,
			linkResult,
			settings,
			cache,
		);

		expect(cached.preprocessed).toBe(first.preprocessed);
		expect(preprocessLinkDisplayData).toHaveBeenCalledTimes(1);
		expect(preprocessTagDisplayData).toHaveBeenCalledTimes(1);

		const next = computePreprocessedDisplayDataState(
			builder,
			{
				...linkResult,
				taggedNotes: [createTaggedNote("unique.md")],
			},
			settings,
			cache,
		);

		expect(preprocessLinkDisplayData).toHaveBeenCalledTimes(1);
		expect(preprocessTagDisplayData).toHaveBeenCalledTimes(2);
		expect(next.preprocessed?.taggedNotes.map((note) => note.path)).toEqual([
			"unique.md",
		]);
	});

	it.each(PREPROCESS_SETTING_KEYS)(
		"invalidates the $s preprocessing dependency",
		(settingKey) => {
			const { builder, preprocessLinkDisplayData, preprocessTagDisplayData } =
				createCacheProbeBuilder();
			const cache = createPreprocessedDisplayDataCache();
			const linkResult = createLinkResult([], []);
			const first = computePreprocessedDisplayDataState(
				builder,
				linkResult,
				DEFAULT_SETTINGS,
				cache,
			);
			preprocessLinkDisplayData.mockClear();
			preprocessTagDisplayData.mockClear();

			const second = computePreprocessedDisplayDataState(
				builder,
				linkResult,
				{
					...DEFAULT_SETTINGS,
					...PREPROCESS_DEPENDENCY_SETTING_OVERRIDES[settingKey],
				},
				cache,
			);

			expect(second.preprocessed).not.toBe(first.preprocessed);
			expect(preprocessLinkDisplayData).toHaveBeenCalledTimes(
				settingKey === "tagFeaturesEnabled" || settingKey === "showTagsSection"
					? 0
					: 1,
			);
			expect(preprocessTagDisplayData).toHaveBeenCalledTimes(1);
		},
	);
});
