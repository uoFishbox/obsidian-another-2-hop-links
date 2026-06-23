import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type {
	DisplayDataBuilder,
	LinkPreprocessedDisplayData,
	TagPreprocessedDisplayData,
} from "application/presenters/displayDataBuilder";
import type { TaggedNote, TwoHopIndexedLink, TwoHopLinkResult } from "types/domain";
import { DEFAULT_SETTINGS, type PluginSettings } from "types/settings";
import {
	computePreprocessedDisplayDataState,
	createPreprocessedDisplayDataCache,
} from "ui/stores/application/DisplayStateCalculator";
import { PREPROCESS_CACHE_SETTING_DEPENDENCIES } from "application/presenters/displayCacheDependencies";

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
	const preprocessLinkDisplayData = vi.fn();
	const preprocessTagDisplayData = vi.fn();
	const preprocessDisplayData = vi.fn(
		(linkResult: TwoHopLinkResult | undefined, settings: PluginSettings) => {
			const usedKeys = new Set<string>();
			const resolvedBacklinks =
				linkResult?.backlinks.filter((backlink) => {
					const key = backlink.path ?? backlink.rawText;
					if (usedKeys.has(key)) return false;
					usedKeys.add(key);
					return true;
				}) ?? [];
			const taggedNotes =
				settings.showTagsSection && linkResult
					? linkResult.taggedNotes.filter((taggedNote) => {
							if (usedKeys.has(taggedNote.path)) return false;
							usedKeys.add(taggedNote.path);
							return true;
						})
					: [];

			return {
				resolvedBranches: [],
				resolvedBacklinks,
				mergedBaseItems: [...resolvedBacklinks],
				twoHopBranches: [],
				nonEmptyTwoHopBranches: [],
				newLinks: [],
				taggedNotes,
				rawTagGroups: taggedNotes.length
					? [{ tag: "#tag", notes: taggedNotes }]
					: [],
			};
		},
	);

	const builder: DisplayDataBuilder = {
		preprocessDisplayData,
		preprocessLinkDisplayData,
		preprocessTagDisplayData,
		sortAndAssembleDisplayData: vi.fn(),
		getSortedTwoHopItems: vi.fn((items) => items),
		getSortedTagGroupItems: vi.fn((items) => items),
		getSortContextVersion: vi.fn(() => 0),
	};

	return {
		builder,
		preprocessDisplayData,
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
	(typeof PREPROCESS_CACHE_SETTING_DEPENDENCIES)[number]["key"],
	Partial<PluginSettings>
>;

function createCacheProbeBuilder() {
	const preprocessLinkDisplayData = vi.fn(
		(
			_linkResult: TwoHopLinkResult | undefined,
			_settings: PluginSettings,
		): LinkPreprocessedDisplayData => ({
			resolvedBranches: [],
			resolvedBacklinks: [],
			mergedBaseItems: [],
			twoHopBranches: [],
			nonEmptyTwoHopBranches: [],
			newLinks: [],
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
		preprocessDisplayData: vi.fn((linkResult, settings) => ({
			...preprocessLinkDisplayData(linkResult, settings),
			...preprocessTagDisplayData(linkResult, settings),
		})),
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
	it("uses full preprocessing when dedupeCards is enabled", () => {
		const {
			builder,
			preprocessDisplayData,
			preprocessLinkDisplayData,
			preprocessTagDisplayData,
		} = createFullDedupeBuilder();
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
		expect(preprocessDisplayData).toHaveBeenCalledTimes(1);
		expect(preprocessLinkDisplayData).not.toHaveBeenCalled();
		expect(preprocessTagDisplayData).not.toHaveBeenCalled();

		const next = computePreprocessedDisplayDataState(
			builder,
			createLinkResult(backlinks, [createTaggedNote("unique.md")]),
			settings,
			cache,
		);

		expect(preprocessDisplayData).toHaveBeenCalledTimes(2);
		expect(next.preprocessed?.taggedNotes.map((note) => note.path)).toEqual([
			"unique.md",
		]);
	});

	it.each(PREPROCESS_CACHE_SETTING_DEPENDENCIES)(
		"invalidates the declared $key preprocessing dependency",
		(dependency) => {
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
					...PREPROCESS_DEPENDENCY_SETTING_OVERRIDES[dependency.key],
				},
				cache,
			);

			expect(second.preprocessed).not.toBe(first.preprocessed);
			expect(preprocessLinkDisplayData).toHaveBeenCalledTimes(1);
			expect(preprocessTagDisplayData).toHaveBeenCalledTimes(1);
		},
	);
});
