import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { DisplayData } from "two-hop/display/displayDataBuilder";
import { DEFAULT_SETTINGS } from "settings/model";
import type { TaggedNote, IndexedLink } from "indexing/model";
import type { TwoHopLinkBranch } from "two-hop/model";
import { createTwoHopSectionPublicationMemo } from "two-hop/ui/section-descriptors/cache";
import { createTwoHopInteractionTokenAllocator } from "two-hop/ui/section-descriptors/descriptors";
import { buildScopedSectionId } from "cards/components/listPagination";

const sourceFile = { path: "source.md" } as TFile;

interface SectionPublicationHarnessStore {
	readonly sectionExpandedLimits: Record<string, number>;
	readonly loadMoreIncrement: number;
	getSortContextVersion(): number;
	getSortedTagGroupItems(items: readonly TaggedNote[]): readonly TaggedNote[];
	getSortedTwoHopItems(items: readonly IndexedLink[]): readonly IndexedLink[];
	getDefaultSectionVisibleLimit(): number;
	getSectionExpandedLimit(sectionId: string): number | undefined;
	setSectionExpandedLimit(sectionId: string, limit: number): void;
}

function createLink(path: string): IndexedLink {
	return { rawText: path, path, isUnresolved: false, sourceFile };
}

function createNote(path: string, tag: string): TaggedNote {
	return {
		path,
		file: { path, basename: path.replace(/\.md$/, "") } as TFile,
		commonTags: [tag],
	} as TaggedNote;
}

function createDisplayData(
	tagGroups: DisplayData["tagGroups"] = [],
	twoHopBranches: DisplayData["twoHopBranches"] = [],
): DisplayData {
	return {
		outgoing: [],
		backlinks: [],
		mergedItems: [],
		twoHopBranches,
		tagGroups,
		newLinks: [],
	};
}

function createHarness(defaultVisibleLimit = 20, loadMoreIncrement = 20) {
	let sortContextVersion = 0;
	const paginationState: {
		expandedLimits: Record<string, number>;
	} = {
		expandedLimits: {},
	};
	const applicationStore = {
		get sectionExpandedLimits() {
			return paginationState.expandedLimits;
		},
		loadMoreIncrement,
		getSortContextVersion: () => sortContextVersion,
		getSortedTagGroupItems: vi.fn((items: readonly TaggedNote[]) => items),
		getSortedTwoHopItems: vi.fn((items: readonly IndexedLink[]) => items),
		getDefaultSectionVisibleLimit: vi.fn(() => defaultVisibleLimit),
		getSectionExpandedLimit: vi.fn(
			(sectionId: string) => paginationState.expandedLimits[sectionId],
		),
		setSectionExpandedLimit: vi.fn((sectionId: string, limit: number) => {
			paginationState.expandedLimits = {
				...paginationState.expandedLimits,
				[sectionId]: limit,
			};
		}),
	} satisfies SectionPublicationHarnessStore;
	const createVisibleCountResolver =
		(scope = "") =>
		(sectionId: string, totalCount: number): number => {
			const paginationId = buildScopedSectionId(sectionId, scope);
			const defaultLimit = Math.max(
				0,
				Math.floor(applicationStore.getDefaultSectionVisibleLimit()),
			);
			const expandedLimit = Math.max(
				0,
				Math.floor(applicationStore.getSectionExpandedLimit(paginationId) ?? 0),
			);
			return Math.min(totalCount, Math.max(defaultLimit, expandedLimit));
		};
	const params = {
		displayData: createDisplayData(),
		useMergedLinks: false,
		showTags: true,
		sourceFile,
		resolveFile: vi.fn(() => null),
		fileToLinktext: vi.fn(() => ""),
		currentSort: DEFAULT_SETTINGS.lastUsedSortOption,
		currentSettings: DEFAULT_SETTINGS,
		sortContextVersion,
		getSortedTwoHopItems: (items: readonly IndexedLink[]) =>
			applicationStore.getSortedTwoHopItems(items),
		getSortedTagGroupItems: (items: readonly TaggedNote[]) =>
			applicationStore.getSortedTagGroupItems(items),
		getVisibleCount: createVisibleCountResolver(),
		interactionTokens: createTwoHopInteractionTokenAllocator(),
		onTagClick: vi.fn(),
	};
	return {
		applicationStore,
		params,
		clearExpandedLimits: () => {
			paginationState.expandedLimits = {};
		},
		createVisibleCountResolver,
		incrementSortContext: () => {
			sortContextVersion += 1;
			return sortContextVersion;
		},
	};
}

describe("createTwoHopSectionPublicationMemo", () => {
	it("publishes frozen eager sections and reuses exact inputs", () => {
		const cache = createTwoHopSectionPublicationMemo();
		const { params, applicationStore } = createHarness();
		const group = { tag: "alpha", notes: [createNote("alpha.md", "alpha")] };
		const input = { ...params, displayData: createDisplayData([group]) };

		const first = cache.resolve(input);
		const second = cache.resolve(input);

		expect(second).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first[0])).toBe(true);
		expect(Object.isFrozen(first[0]?.items)).toBe(true);
		expect(first[0]?.items).toHaveLength(1);
		expect(applicationStore.getSortedTagGroupItems).toHaveBeenCalledTimes(1);
	});

	it("replaces only a section whose source identity changes", () => {
		const cache = createTwoHopSectionPublicationMemo();
		const { params } = createHarness();
		const alpha = { tag: "alpha", notes: [createNote("alpha.md", "alpha")] };
		const beta = { tag: "beta", notes: [createNote("beta.md", "beta")] };
		const first = cache.resolve({
			...params,
			displayData: createDisplayData([alpha, beta]),
		});
		const changed = cache.resolve({
			...params,
			displayData: createDisplayData([
				alpha,
				{ ...beta, notes: [...beta.notes, createNote("beta-2.md", "beta")] },
			]),
		});

		expect(changed[0]).toBe(first[0]);
		expect(changed[1]).not.toBe(first[1]);
		expect(changed[1]?.items).toHaveLength(2);
	});

	it("republishes sorted branches after a sort-context change", () => {
		const cache = createTwoHopSectionPublicationMemo();
		const { params, incrementSortContext } = createHarness();
		const branch: TwoHopLinkBranch = {
			hop1: createLink("parent.md"),
			hop2: [createLink("child.md")],
		};
		const input = { ...params, displayData: createDisplayData([], [branch]) };
		const first = cache.resolve(input);
		const second = cache.resolve({
			...input,
			sortContextVersion: incrementSortContext(),
		});

		expect(second[0]).not.toBe(first[0]);
		expect(second[0]?.items[0]?.interactionId).toBe(
			first[0]?.items[0]?.interactionId,
		);
	});

	it("expands only the requested prefix while preserving item identity and sorting", () => {
		const cache = createTwoHopSectionPublicationMemo();
		const {
			params,
			applicationStore,
			clearExpandedLimits,
			createVisibleCountResolver,
		} = createHarness(1, 1);
		const group = {
			tag: "alpha",
			notes: [
				createNote("one.md", "alpha"),
				createNote("two.md", "alpha"),
				createNote("three.md", "alpha"),
			],
		};
		const input = {
			...params,
			displayData: createDisplayData([group]),
			getVisibleCount: createVisibleCountResolver("query"),
		};
		const first = cache.resolve(input);
		const firstItem = first[0]?.items[0];
		applicationStore.setSectionExpandedLimit(
			buildScopedSectionId("tags-alpha", "query"),
			2,
		);
		const expandedInput = {
			...input,
			getVisibleCount: createVisibleCountResolver("query"),
		};
		const second = cache.resolve(expandedInput);
		const resolvedAgain = cache.resolve(expandedInput);

		expect(first[0]?.items).toHaveLength(1);
		expect(first[0]?.totalCount).toBe(3);
		expect(second[0]?.items).toHaveLength(2);
		expect(second[0]?.items[0]).toBe(firstItem);
		expect(resolvedAgain).toBe(second);
		expect(applicationStore.getSortedTagGroupItems).toHaveBeenCalledTimes(1);
		expect(applicationStore.setSectionExpandedLimit).toHaveBeenCalledWith(
			expect.stringMatching(/^s:/),
			2,
		);

		clearExpandedLimits();
		const collapsed = cache.resolve({
			...input,
			getVisibleCount: createVisibleCountResolver("query"),
		});
		expect(collapsed[0]?.items).toHaveLength(1);
	});

	it("republishes a tag section when its callback identity changes", () => {
		const cache = createTwoHopSectionPublicationMemo();
		const { params } = createHarness();
		const group = { tag: "alpha", notes: [createNote("alpha.md", "alpha")] };
		const firstCallback = vi.fn();
		const secondCallback = vi.fn();
		const input = {
			...params,
			displayData: createDisplayData([group]),
			onTagClick: firstCallback,
		};
		const first = cache.resolve(input);
		const second = cache.resolve({ ...input, onTagClick: secondCallback });

		expect(second).not.toBe(first);
		expect(second[0]).not.toBe(first[0]);
		second[0]?.header.props.onClick?.();
		expect(firstCallback).not.toHaveBeenCalled();
		expect(secondCallback).toHaveBeenCalledWith("alpha");
	});
});
