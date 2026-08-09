import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import {
	ApplicationStore,
	type DisplayDataBuilder,
} from "ui/stores/ApplicationStore.svelte";
import type { ResolveTwoHopLinks } from "features/two-hop/application/TwoHopLinksLoader";
import type {
	DisplayData,
	PreprocessedDisplayData,
} from "features/two-hop/application/displayDataBuilder";
import type {
	DisplayDataVersions,
	ResolveProgress,
	TwoHopIndexedLink,
	TwoHopLinkBranch,
	TwoHopLinkResult,
} from "types/domain";
import {
	DEFAULT_SETTINGS,
	type PluginSettings,
	type SortOption,
} from "features/settings/model";

function createEmptyDisplayData(): DisplayData {
	return {
		outgoing: [],
		backlinks: [],
		mergedItems: [],
		twoHopBranches: [],
		tagGroups: [],
		newLinks: [],
	};
}

function createDisplayVersions(
	versionSeed: number | string,
	links: string,
	tags: string,
): DisplayDataVersions {
	const prefix = String(versionSeed);
	return {
		links: `${prefix}:${links}`,
		tags: `${prefix}:${tags}`,
	};
}

function createLinkResult(originPath: string): TwoHopLinkResult {
	const originFile = createMockTFile(originPath);
	const sourceFile = createMockTFile(`src-${originPath}`);

	const backlink: TwoHopIndexedLink = {
		rawText: sourceFile.basename,
		path: sourceFile.path,
		isUnresolved: false,
		sourceFile,
	};

	return {
		originFile,
		branches: [],
		backlinks: [backlink],
		taggedNotes: [],
	};
}

function createLinkResultWithBranch(
	originPath: string,
	branchTargetPath: string,
): TwoHopLinkResult {
	const originFile = createMockTFile(originPath);
	const branchTargetFile = createMockTFile(branchTargetPath);

	return {
		originFile,
		branches: [
			{
				hop1: {
					rawText: branchTargetFile.basename,
					path: branchTargetFile.path,
					isUnresolved: false,
					sourceFile: originFile,
				},
				hop2: [],
			},
		],
		backlinks: [],
		taggedNotes: [],
	};
}

function createBuildDisplayDataMock() {
	return createStagedBuildDisplayDataMock().builder;
}

function createStagedBuildDisplayDataMock() {
	const preprocessDisplayData = vi.fn(
		(
			linkResult: TwoHopLinkResult | undefined,
			_settings: PluginSettings,
		): PreprocessedDisplayData => {
			const resolvedBranches = linkResult?.branches ?? [];
			const resolvedBacklinks = linkResult?.backlinks ?? [];
			return {
				resolvedBranches,
				resolvedBacklinks,
				mergedBaseItems: [...resolvedBranches, ...resolvedBacklinks],
				taggedNotes: [],
				rawTagGroups: [],
				twoHopBranches: [],
				nonEmptyTwoHopBranches: [],
				newLinks: [],
			};
		},
	);

	const sortAndAssembleDisplayData = vi.fn(
		(
			preprocessed: PreprocessedDisplayData,
			_settings: PluginSettings,
			_sortOption: SortOption,
		): DisplayData => ({
			...createEmptyDisplayData(),
			outgoing: [...preprocessed.resolvedBranches],
			backlinks: [...preprocessed.resolvedBacklinks],
		}),
	);

	const builder: DisplayDataBuilder = {
		preprocessDisplayData,
		preprocessLinkDisplayData: vi.fn((linkResult, settings) =>
			preprocessDisplayData(linkResult, settings),
		),
		preprocessTagDisplayData: vi.fn((linkResult, settings) => ({
			taggedNotes: preprocessDisplayData(linkResult, settings).taggedNotes,
			rawTagGroups: preprocessDisplayData(linkResult, settings).rawTagGroups,
		})),
		sortAndAssembleDisplayData,
		getSortedTwoHopItems: vi.fn((items) => items),
		getSortedTagGroupItems: vi.fn((items) => items),
		getSortContextVersion: vi.fn(() => 0),
	};

	return {
		builder,
		preprocessDisplayData,
		sortAndAssembleDisplayData,
	};
}

function createSplitStagedBuildDisplayDataMock() {
	const preprocessLinkDisplayData = vi.fn(
		(linkResult: TwoHopLinkResult | undefined, _settings: PluginSettings) => {
			const resolvedBranches = linkResult?.branches ?? [];
			const resolvedBacklinks = linkResult?.backlinks ?? [];
			return {
				resolvedBranches,
				resolvedBacklinks,
				mergedBaseItems: [...resolvedBranches, ...resolvedBacklinks],
				twoHopBranches: resolvedBranches,
				nonEmptyTwoHopBranches: resolvedBranches.filter(
					(branch) => branch.hop2.length > 0,
				),
				newLinks: [],
			};
		},
	);

	const preprocessTagDisplayData = vi.fn(
		(linkResult: TwoHopLinkResult | undefined, settings: PluginSettings) => {
			const taggedNotes =
				settings.showTagsSection && linkResult ? linkResult.taggedNotes : [];
			return {
				taggedNotes,
				rawTagGroups: taggedNotes.length
					? [
							{
								tag: taggedNotes[0].commonTags[0] ?? "#tag",
								notes: [...taggedNotes],
							},
						]
					: [],
			};
		},
	);

	const sortCache = new Map<string, WeakMap<object, readonly unknown[]>>();
	let linkSortCalls = 0;
	let tagSortCalls = 0;

	const getSortedWithCache = <T>(
		items: readonly T[],
		sortOption: SortOption,
		onCacheMiss: () => void,
	): readonly T[] => {
		if (items.length <= 1) {
			return items;
		}

		const sortCacheKey = sortOption;
		const cachedSortedItemsByOption =
			sortCache.get(sortCacheKey) ?? new WeakMap<object, readonly unknown[]>();
		if (!sortCache.has(sortCacheKey)) {
			sortCache.set(sortCacheKey, cachedSortedItemsByOption);
		}

		const cachedSortedItems = cachedSortedItemsByOption.get(items as object);
		if (cachedSortedItems) {
			return cachedSortedItems as readonly T[];
		}

		onCacheMiss();
		cachedSortedItemsByOption.set(items as object, [...items]);
		return [...items];
	};

	const sortAndAssembleDisplayData = vi.fn(
		(
			preprocessed: PreprocessedDisplayData,
			settings: PluginSettings,
			sortOption: SortOption,
		): DisplayData => {
			let outgoing: readonly TwoHopLinkBranch[] = [];
			let backlinks: readonly TwoHopIndexedLink[] = [];
			let mergedItems: DisplayData["mergedItems"] = [];

			if (settings.useMergedLinksSection) {
				mergedItems = getSortedWithCache(
					preprocessed.mergedBaseItems,
					sortOption,
					() => {
						linkSortCalls += 1;
					},
				);
			} else {
				outgoing = getSortedWithCache(
					preprocessed.resolvedBranches,
					sortOption,
					() => {
						linkSortCalls += 1;
					},
				);
				backlinks = getSortedWithCache(
					preprocessed.resolvedBacklinks,
					sortOption,
					() => {
						linkSortCalls += 1;
					},
				);
			}

			const tagGroups = settings.showTagsSection
				? preprocessed.rawTagGroups.map((section) => ({
						...section,
						notes: getSortedWithCache(section.notes, sortOption, () => {
							tagSortCalls += 1;
						}),
					}))
				: [];

			return {
				outgoing,
				backlinks,
				mergedItems,
				twoHopBranches: preprocessed.nonEmptyTwoHopBranches,
				tagGroups,
				newLinks: getSortedWithCache(preprocessed.newLinks, sortOption, () => {
					linkSortCalls += 1;
				}),
			};
		},
	);

	const builder: DisplayDataBuilder = {
		preprocessDisplayData: vi.fn(
			(linkResult: TwoHopLinkResult | undefined, settings: PluginSettings) => ({
				...preprocessLinkDisplayData(linkResult, settings),
				...preprocessTagDisplayData(linkResult, settings),
			}),
		),
		preprocessLinkDisplayData,
		preprocessTagDisplayData,
		sortAndAssembleDisplayData,
		getSortedTwoHopItems: vi.fn((items) => items),
		getSortedTagGroupItems: vi.fn((items) => items),
		getSortContextVersion: vi.fn(() => 0),
	};

	return {
		builder,
		preprocessLinkDisplayData,
		preprocessTagDisplayData,
		sortAndAssembleDisplayData,
		get linkSortCalls() {
			return linkSortCalls;
		},
		get tagSortCalls() {
			return tagSortCalls;
		},
	};
}

function createStore(
	params: {
		settings?: PluginSettings;
		buildDisplayDataMock?: DisplayDataBuilder;
		resolveTwoHopLinks?: ResolveTwoHopLinks;
		onSortChange?: (option: SortOption) => void;
	} = {},
) {
	const settings = params.settings ?? { ...DEFAULT_SETTINGS };
	const buildDisplayDataMock =
		params.buildDisplayDataMock ?? createBuildDisplayDataMock();
	const resolveTwoHopLinks =
		params.resolveTwoHopLinks ??
		(async (file: TFile) => createLinkResult(file.path));
	const onSortChange = params.onSortChange ?? vi.fn();

	const store = new ApplicationStore(
		settings,
		buildDisplayDataMock,
		resolveTwoHopLinks,
		onSortChange,
	);

	return {
		store,
		settings,
		buildDisplayDataMock,
		resolveTwoHopLinks,
		onSortChange,
	};
}

describe("ApplicationStore (Runes)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates loading/error/data on successful load", async () => {
		const file = createMockTFile("target.md");
		const expected = createLinkResult(file.path);
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockResolvedValue(expected);
		const { store } = createStore({ resolveTwoHopLinks });

		expect(store.loading).toBe(true);
		expect(store.loadingPhase).toBe("initial");
		expect(store.loadState).toStrictEqual({
			type: "loading",
			phase: "initial",
		});
		expect(store.data).toBeUndefined();
		expect(store.error).toBeUndefined();

		await store.load(file);

		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(1);
		expect(store.loading).toBe(false);
		expect(store.loadingPhase).toBe("complete");
		expect(store.loadState).toMatchObject({
			type: "loaded",
			phase: "complete",
			data: expected,
			displaySourceData: expected,
		});
		expect(store.data).toStrictEqual(expected);
		expect(store.error).toBeUndefined();
	});

	it("stages base -> twohop -> complete in order on initial load", async () => {
		const file = createMockTFile("target.md");
		const originFile = createMockTFile(file.path);
		const hop1Target = createMockTFile("hop1.md");
		const hop2Source = createMockTFile("hop2.md");
		const baseResult: TwoHopLinkResult = {
			originFile,
			branches: [
				{
					hop1: {
						rawText: hop1Target.basename,
						path: hop1Target.path,
						isUnresolved: false,
						sourceFile: originFile,
					},
					hop2: [],
				},
			],
			backlinks: [],
			taggedNotes: [],
		};
		const twohopResult: TwoHopLinkResult = {
			...baseResult,
			branches: [
				{
					...baseResult.branches[0],
					hop2: [
						{
							rawText: hop1Target.basename,
							path: hop1Target.path,
							isUnresolved: false,
							sourceFile: hop2Source,
						},
					],
				},
			],
		};
		const completeResult: TwoHopLinkResult = {
			...twohopResult,
			taggedNotes: [
				{
					file: createMockTFile("tagged.md"),
					commonTags: ["tag"],
					path: "tagged.md",
				},
			],
		};

		let onProgress: ((progress: ResolveProgress) => void) | undefined;
		let resolveLoad!: (value: TwoHopLinkResult) => void;
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockImplementation(async (_file, progress) => {
				onProgress = progress;
				return await new Promise<TwoHopLinkResult>((resolve) => {
					resolveLoad = resolve;
				});
			});
		const { store } = createStore({ resolveTwoHopLinks });

		const loadPromise = store.load(file);
		expect(store.loading).toBe(true);
		expect(store.loadingPhase).toBe("initial");

		onProgress?.({ phase: "base", data: baseResult });
		await Promise.resolve();
		expect(store.loading).toBe(false);
		expect(store.loadingPhase).toBe("base-ready");
		expect(store.data).toStrictEqual(baseResult);

		onProgress?.({ phase: "twohop", data: twohopResult });
		await Promise.resolve();
		expect(store.loadingPhase).toBe("twohop-ready");
		expect(store.data).toStrictEqual(twohopResult);

		onProgress?.({ phase: "complete", data: completeResult });
		resolveLoad(completeResult);
		await loadPromise;

		expect(store.loading).toBe(false);
		expect(store.loadingPhase).toBe("complete");
		expect(store.data).toStrictEqual(completeResult);
		expect(store.error).toBeUndefined();
	});

	it("does not rebuild displayData on complete no-op update when tags are hidden", async () => {
		const file = createMockTFile("target.md");
		const originFile = createMockTFile(file.path);
		const hop1Target = createMockTFile("hop1.md");
		const hop2Source = createMockTFile("hop2.md");
		const staged = createSplitStagedBuildDisplayDataMock();

		const baseResult: TwoHopLinkResult = {
			originFile,
			branches: [
				{
					hop1: {
						rawText: hop1Target.basename,
						path: hop1Target.path,
						isUnresolved: false,
						sourceFile: originFile,
					},
					hop2: [],
				},
			],
			backlinks: [
				{
					rawText: "backlink",
					path: "backlink.md",
					isUnresolved: false,
					sourceFile: createMockTFile("backlink.md"),
				},
			],
			taggedNotes: [],
			displayVersions: createDisplayVersions(1, "base", "pending"),
		};
		const twohopResult: TwoHopLinkResult = {
			...baseResult,
			branches: [
				{
					...baseResult.branches[0],
					hop2: [
						{
							rawText: hop1Target.basename,
							path: hop1Target.path,
							isUnresolved: false,
							sourceFile: hop2Source,
						},
					],
				},
			],
			displayVersions: createDisplayVersions(1, "twohop", "pending"),
		};
		const completeResult: TwoHopLinkResult = {
			...twohopResult,
			branches: twohopResult.branches.map((branch) => ({
				...branch,
				hop2: [...branch.hop2],
			})),
			backlinks: [...twohopResult.backlinks],
			taggedNotes: [
				{
					file: createMockTFile("tagged.md"),
					commonTags: ["tag"],
					path: "tagged.md",
				},
			],
			displayVersions: createDisplayVersions(1, "twohop", "tags"),
		};

		let onProgress: ((progress: ResolveProgress) => void) | undefined;
		let resolveLoad!: (value: TwoHopLinkResult) => void;
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockImplementation(async (_file, progress) => {
				onProgress = progress;
				return await new Promise<TwoHopLinkResult>((resolve) => {
					resolveLoad = resolve;
				});
			});
		const { store } = createStore({
			resolveTwoHopLinks,
			buildDisplayDataMock: staged.builder,
			settings: { ...DEFAULT_SETTINGS, showTagsSection: false },
		});

		const loadPromise = store.load(file);

		onProgress?.({ phase: "base", data: baseResult });
		await Promise.resolve();
		void store.displayData;

		onProgress?.({ phase: "twohop", data: twohopResult });
		await Promise.resolve();
		const displayDataAfterTwohop = store.displayData;

		onProgress?.({ phase: "complete", data: completeResult });
		resolveLoad(completeResult);
		await loadPromise;

		// showTagsSection: false の場合、complete 段階でも displayData は変化しない
		expect(store.displayData).toBe(displayDataAfterTwohop);
		expect(store.data).toBe(completeResult);
	});

	it("tag data is reflected in displayData at complete when tags are shown", async () => {
		const file = createMockTFile("target.md");
		const originFile = createMockTFile(file.path);
		const hop1Target = createMockTFile("hop1.md");
		const hop2Source = createMockTFile("hop2.md");
		const staged = createSplitStagedBuildDisplayDataMock();

		const baseResult: TwoHopLinkResult = {
			originFile,
			branches: [
				{
					hop1: {
						rawText: hop1Target.basename,
						path: hop1Target.path,
						isUnresolved: false,
						sourceFile: originFile,
					},
					hop2: [],
				},
			],
			backlinks: [
				{
					rawText: "backlink",
					path: "backlink.md",
					isUnresolved: false,
					sourceFile: createMockTFile("backlink.md"),
				},
			],
			taggedNotes: [],
			displayVersions: createDisplayVersions(2, "base", "pending"),
		};
		const twohopResult: TwoHopLinkResult = {
			...baseResult,
			branches: [
				{
					...baseResult.branches[0],
					hop2: [
						{
							rawText: hop1Target.basename,
							path: hop1Target.path,
							isUnresolved: false,
							sourceFile: hop2Source,
						},
					],
				},
			],
			displayVersions: createDisplayVersions(2, "twohop", "pending"),
		};
		const completeResult: TwoHopLinkResult = {
			...twohopResult,
			branches: twohopResult.branches.map((branch) => ({
				...branch,
				hop2: [...branch.hop2],
			})),
			backlinks: [...twohopResult.backlinks],
			taggedNotes: [
				{
					file: createMockTFile("tagged-a.md"),
					commonTags: ["#alpha"],
					path: "tagged-a.md",
				},
				{
					file: createMockTFile("tagged-b.md"),
					commonTags: ["#alpha"],
					path: "tagged-b.md",
				},
			],
			displayVersions: createDisplayVersions(2, "twohop", "tags"),
		};

		let onProgress: ((progress: ResolveProgress) => void) | undefined;
		let resolveLoad!: (value: TwoHopLinkResult) => void;
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockImplementation(async (_file, progress) => {
				onProgress = progress;
				return await new Promise<TwoHopLinkResult>((resolve) => {
					resolveLoad = resolve;
				});
			});
		const { store } = createStore({
			resolveTwoHopLinks,
			buildDisplayDataMock: staged.builder,
		});

		const loadPromise = store.load(file);

		onProgress?.({ phase: "base", data: baseResult });
		await Promise.resolve();
		void store.displayData;

		onProgress?.({ phase: "twohop", data: twohopResult });
		await Promise.resolve();
		const displayDataAfterTwohop = store.displayData;

		onProgress?.({ phase: "complete", data: completeResult });
		void store.displayData;
		resolveLoad(completeResult);
		await loadPromise;

		// complete 段階で taggedNotes が追加され、displayData が更新される
		expect(store.displayData).not.toBe(displayDataAfterTwohop);
		expect(store.displayData.tagGroups).toHaveLength(1);
		expect(store.displayData.tagGroups[0].notes).toHaveLength(2);
		expect(store.data).toBe(completeResult);
	});

	it("clears data and retains error on normal load failure", async () => {
		const file = createMockTFile("target.md");
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockRejectedValue(new Error("load failed"));
		const { store } = createStore({ resolveTwoHopLinks });

		await store.load(file);

		expect(store.loading).toBe(false);
		expect(store.loadingPhase).toBe("idle");
		expect(store.data).toBeUndefined();
		expect(store.error?.message).toBe("load failed");
	});

	it("shares an in-flight load for the same file", async () => {
		const file = createMockTFile("target.md");
		let resolveLoad!: (value: TwoHopLinkResult) => void;
		const resolveTwoHopLinks = vi.fn<ResolveTwoHopLinks>().mockImplementation(
			async () =>
				await new Promise<TwoHopLinkResult>((resolve) => {
					resolveLoad = resolve;
				}),
		);
		const { store } = createStore({ resolveTwoHopLinks });

		const first = store.load(file);
		const second = store.load(file);

		expect(second).toBe(first);
		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(1);

		resolveLoad(createLinkResult(file.path));
		await Promise.all([first, second]);
	});

	it("starts a new in-flight load when force is true", async () => {
		const file = createMockTFile("target.md");
		const resolvers: Array<(value: TwoHopLinkResult) => void> = [];
		const resolveTwoHopLinks = vi.fn<ResolveTwoHopLinks>().mockImplementation(
			async () =>
				await new Promise<TwoHopLinkResult>((resolve) => {
					resolvers.push(resolve);
				}),
		);
		const { store } = createStore({ resolveTwoHopLinks });

		const first = store.load(file);
		const forced = store.load(file, { force: true });

		expect(forced).not.toBe(first);
		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(2);

		resolvers[1](createLinkResult(file.path));
		await forced;
		resolvers[0](createLinkResult(file.path));
		await first;
	});

	it("does not share an in-flight load with a different file", async () => {
		const firstFile = createMockTFile("first.md");
		const secondFile = createMockTFile("second.md");
		const resolvers: Array<(value: TwoHopLinkResult) => void> = [];
		const resolveTwoHopLinks = vi.fn<ResolveTwoHopLinks>().mockImplementation(
			async () =>
				await new Promise<TwoHopLinkResult>((resolve) => {
					resolvers.push(resolve);
				}),
		);
		const { store } = createStore({ resolveTwoHopLinks });

		const first = store.load(firstFile);
		const second = store.load(secondFile);

		expect(second).not.toBe(first);
		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(2);

		resolvers[1](createLinkResult(secondFile.path));
		await second;
		resolvers[0](createLinkResult(firstFile.path));
		await first;
	});

	it("reset returns the load lifecycle to idle without residual data", async () => {
		const file = createMockTFile("target.md");
		const { store } = createStore();

		await store.load(file);
		store.reset();

		expect(store.loadState).toStrictEqual({ type: "idle" });
		expect(store.loading).toBe(false);
		expect(store.loadingPhase).toBe("idle");
		expect(store.data).toBeUndefined();
		expect(store.displaySourceData).toBeUndefined();
		expect(store.error).toBeUndefined();
	});

	it("retains existing data and updates only error on background refresh failure", async () => {
		const file = createMockTFile("target.md");
		const firstResult = createLinkResult(file.path);
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockResolvedValueOnce(firstResult)
			.mockRejectedValueOnce(new Error("refresh failed"));
		const { store } = createStore({ resolveTwoHopLinks });

		await store.load(file);
		expect(store.data).toStrictEqual(firstResult);
		expect(store.error).toBeUndefined();
		expect(store.loadingPhase).toBe("complete");

		await store.load(file, { force: true });

		expect(store.loading).toBe(false);
		expect(store.loadingPhase).toBe("complete");
		expect(store.data).toStrictEqual(firstResult);
		expect(store.error?.message).toBe("refresh failed");
		expect(store.loadState).toMatchObject({
			type: "error",
			error: { message: "refresh failed" },
			previousData: {
				phase: "complete",
				data: firstResult,
				displaySourceData: firstResult,
			},
		});
	});

	it("ignores stale response in competing requests", async () => {
		const fileA = createMockTFile("A.md");
		const fileB = createMockTFile("B.md");
		const signals: AbortSignal[] = [];

		let resolveA!: (value: TwoHopLinkResult) => void;
		let resolveB!: (value: TwoHopLinkResult) => void;

		const promiseA = new Promise<TwoHopLinkResult>((resolve) => {
			resolveA = resolve;
		});
		const promiseB = new Promise<TwoHopLinkResult>((resolve) => {
			resolveB = resolve;
		});

		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockImplementationOnce(async (_file, _onProgress, signal) => {
				if (signal) signals.push(signal);
				return promiseA;
			})
			.mockImplementationOnce(async (_file, _onProgress, signal) => {
				if (signal) signals.push(signal);
				return promiseB;
			});

		const { store } = createStore({ resolveTwoHopLinks });

		const loadA = store.load(fileA);
		const loadB = store.load(fileB);
		expect(signals).toHaveLength(2);
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);

		const latestResult = createLinkResult(fileB.path);
		resolveB(latestResult);
		await loadB;

		const staleResult = createLinkResult(fileA.path);
		resolveA(staleResult);
		await loadA;

		expect(store.data).toStrictEqual(latestResult);
		expect(store.error).toBeUndefined();
		expect(store.loading).toBe(false);
	});

	it("does not recompute displayData on setSectionExpandedLimit", async () => {
		const { store } = createStore();

		await store.load(createMockTFile("current.md"));
		const before = store.displayData;

		store.setSectionExpandedLimit("backlinks", 30);
		const expandedLimit = store.getSectionExpandedLimit("backlinks");
		const after = store.displayData;

		expect(expandedLimit).toBe(30);
		expect(after).toBe(before);
	});

	it("lazy sort resolver calls helper with current sortOption", () => {
		const { store } = createStore();
		const twoHopItems: TwoHopIndexedLink[] = [
			{
				rawText: "b",
				path: "b.md",
				isUnresolved: false,
				sourceFile: createMockTFile("b-source.md"),
			},
		];
		const taggedNotes = [
			{
				file: createMockTFile("note.md"),
				commonTags: ["#tag"],
				path: "note.md",
			},
		];

		store.setSortOption("modified-date");
		const sortedLinks = store.getSortedTwoHopItems(twoHopItems);
		const sortedTags = store.getSortedTagGroupItems(taggedNotes);

		expect(sortedLinks).toStrictEqual(twoHopItems);
		expect(sortedTags).toStrictEqual(taggedNotes);
	});

	it("setSortOption does not re-fire onSortChange for same value", () => {
		const onSortChange = vi.fn();
		const { store } = createStore({ onSortChange });

		store.setSortOption(DEFAULT_SETTINGS.lastUsedSortOption);
		expect(onSortChange).not.toHaveBeenCalled();

		store.setSortOption("modified-date");
		expect(onSortChange).toHaveBeenCalledTimes(1);
		expect(onSortChange).toHaveBeenCalledWith("modified-date");
		expect(store.sortOption).toBe("modified-date");
	});

	it("displayState provides displayData and hasDisplayableItems together", async () => {
		const { store } = createStore();

		await store.load(createMockTFile("current.md"));

		const displayState = store.displayState;

		expect(displayState.displayData.backlinks).toHaveLength(1);
		expect(displayState.hasDisplayableItems).toBe(true);
	});

	it("handleDataUpdate only advances updateVersion for global list store without current file", async () => {
		const resolveTwoHopLinks = vi.fn<ResolveTwoHopLinks>();
		const { store } = createStore({ resolveTwoHopLinks });
		const previousVersion = store.updateVersion;

		await store.handleDataUpdate({
			indexVersion: 2,
			affectedPaths: ["note.md"],
		});

		expect(store.updateVersion).toBe(previousVersion + 1);
		expect(resolveTwoHopLinks).not.toHaveBeenCalled();
	});

	it("handleDataUpdate does not reload on unrelated update", async () => {
		const file = createMockTFile("current.md");
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockResolvedValue(createLinkResultWithBranch(file.path, "target.md"));
		const { store } = createStore({ resolveTwoHopLinks });

		await store.load(file);
		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(1);

		await store.handleDataUpdate({
			indexVersion: 2,
			affectedPaths: ["other.md"],
			affectedLookupKeys: ["other.md"],
			affectedTags: [],
			affectedLinkSourcePaths: [],
			affectedTagSourcePaths: [],
		});

		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(1);
	});

	it("handleDataUpdate reloads on related lookup update", async () => {
		const file = createMockTFile("current.md");
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockResolvedValue(createLinkResultWithBranch(file.path, "target.md"));
		const { store } = createStore({ resolveTwoHopLinks });

		await store.load(file);
		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(1);

		await store.handleDataUpdate({
			indexVersion: 3,
			affectedLookupKeys: ["target.md"],
		});

		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(2);
	});

	it("handleDataUpdate invalidates related preview even with content-only update", async () => {
		const file = createMockTFile("current.md");
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockResolvedValue(createLinkResultWithBranch(file.path, "target.md"));
		const { store } = createStore({ resolveTwoHopLinks });

		await store.load(file);
		const previousPreviewVersion = store.getPreviewRenderVersion("target.md");

		await store.handleDataUpdate({
			indexVersion: 6,
			affectedPaths: ["target.md"],
			affectedLookupKeys: ["unrelated.md"],
			affectedTags: [],
			affectedLinkSourcePaths: [],
			affectedTagSourcePaths: [],
		});

		// preview-only では reload しない
		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(1);
		expect(store.getPreviewRenderVersion("target.md")).not.toBe(
			previousPreviewVersion,
		);
	});

	it("handleDataUpdate reloads on link source update", async () => {
		const file = createMockTFile("current.md");
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockResolvedValue(createLinkResultWithBranch(file.path, "target.md"));
		const { store } = createStore({ resolveTwoHopLinks });

		await store.load(file);

		await store.handleDataUpdate({
			indexVersion: 7,
			affectedPaths: ["target.md"],
			affectedLookupKeys: ["new-child.md"],
			affectedTags: [],
			affectedLinkSourcePaths: ["target.md"],
			affectedTagSourcePaths: [],
		});

		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(2);
	});

	it("handleDataUpdate only advances preview version without load on preview-only update", async () => {
		const file = createMockTFile("current.md");
		const resolveTwoHopLinks = vi
			.fn<ResolveTwoHopLinks>()
			.mockResolvedValue(createLinkResultWithBranch(file.path, "target.md"));
		const { store } = createStore({ resolveTwoHopLinks });

		await store.load(file);
		const previousPreviewVersion = store.getPreviewRenderVersion("target.md");

		await store.handleDataUpdate({
			indexVersion: 8,
			affectedPaths: ["target.md"],
			affectedLookupKeys: [],
			affectedTags: [],
			affectedLinkSourcePaths: [],
			affectedTagSourcePaths: [],
		});

		// reload しない
		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(1);
		// preview version は進む
		expect(store.getPreviewRenderVersion("target.md")).not.toBe(
			previousPreviewVersion,
		);
	});
});
