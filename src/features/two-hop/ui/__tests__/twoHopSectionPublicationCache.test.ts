import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { DisplayData } from "features/two-hop/application/displayDataBuilder";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { TaggedNote, TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import { createTwoHopSectionPublicationCache } from "features/two-hop/ui/section-descriptors/cache";

const sourceFile = { path: "source.md" } as TFile;

function createLink(path: string): TwoHopIndexedLink {
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

function createHarness() {
	let sortContextVersion = 0;
	const applicationStore = {
		getSortContextVersion: () => sortContextVersion,
		getSortedTagGroupItems: vi.fn((items: readonly TaggedNote[]) => items),
		getSortedTwoHopItems: vi.fn((items: readonly TwoHopIndexedLink[]) => items),
	} as unknown as ApplicationStore;
	const params = {
		displayData: createDisplayData(),
		useMergedLinks: false,
		showTags: true,
		sourceFile,
		resolveFile: vi.fn(() => null),
		fileToLinktext: vi.fn(() => ""),
		currentSort: DEFAULT_SETTINGS.lastUsedSortOption,
		currentSettings: DEFAULT_SETTINGS,
		applicationStore,
		onTagClick: vi.fn(),
	};
	return {
		applicationStore,
		params,
		incrementSortContext: () => {
			sortContextVersion += 1;
		},
	};
}

describe("createTwoHopSectionPublicationCache", () => {
	it("publishes frozen eager sections and reuses exact inputs", () => {
		const cache = createTwoHopSectionPublicationCache();
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
		const cache = createTwoHopSectionPublicationCache();
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
		const cache = createTwoHopSectionPublicationCache();
		const { params, incrementSortContext } = createHarness();
		const branch: TwoHopLinkBranch = {
			hop1: createLink("parent.md"),
			hop2: [createLink("child.md")],
		};
		const input = { ...params, displayData: createDisplayData([], [branch]) };
		const first = cache.resolve(input);
		incrementSortContext();
		const second = cache.resolve(input);

		expect(second[0]).not.toBe(first[0]);
		expect(second[0]?.items[0]?.interactionId).toBe(
			first[0]?.items[0]?.interactionId,
		);
	});

	it("uses the latest tag callback without replacing the section", () => {
		const cache = createTwoHopSectionPublicationCache();
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

		expect(second).toBe(first);
		second[0]?.header.props.onClick?.();
		expect(firstCallback).not.toHaveBeenCalled();
		expect(secondCallback).toHaveBeenCalledWith("alpha");
	});
});
