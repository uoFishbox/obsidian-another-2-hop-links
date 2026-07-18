import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { DisplayData } from "application/presenters/displayDataBuilder";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import { DEFAULT_SETTINGS } from "types/settings";
import type { TaggedNote, TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import { createTwoHopSectionDescriptorIdentityCache } from "../twoHopSectionDescriptorIdentityCache";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";

const sourceFile = { path: "source.md" } as TFile;

const createNote = (path: string, tag: string): TaggedNote =>
	({
		path,
		file: {
			path,
			basename: path.replace(/\.md$/, ""),
		},
		commonTags: [tag],
	}) as TaggedNote;

const createLink = (path: string): TwoHopIndexedLink => ({
	rawText: path,
	path,
	isUnresolved: false,
	sourceFile,
});

const createBranch = (path: string, hop2: TwoHopIndexedLink[]): TwoHopLinkBranch => ({
	hop1: createLink(path),
	hop2,
});

const createDisplayData = (
	tagGroups: DisplayData["tagGroups"],
	twoHopBranches: DisplayData["twoHopBranches"] = [],
): DisplayData => ({
	outgoing: [],
	backlinks: [],
	mergedItems: [],
	twoHopBranches,
	tagGroups,
	newLinks: [],
});

const createHarness = () => {
	const getSortedTagGroupItems = vi.fn((items: TaggedNote[]) => items);
	const getSortedTwoHopItems = vi.fn((items: TwoHopIndexedLink[]) => items);
	const applicationStore = {
		updateVersion: 0,
		getSortedTwoHopItems,
		getSortedTagGroupItems,
	} as unknown as ApplicationStore;
	const baseParams = {
		searchQuery: "",
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
		baseParams,
		getSortedTagGroupItems,
		getSortedTwoHopItems,
	};
};

describe("createTwoHopSectionDescriptorIdentityCache", () => {
	it("reuses immutable descriptor output and resolves items lazily", () => {
		resetCCLDevMeasurements();
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams, getSortedTagGroupItems } = createHarness();
		const alpha = {
			tag: "alpha",
			notes: [createNote("alpha.md", "alpha")],
		};
		const params = {
			...baseParams,
			displayData: createDisplayData([alpha]),
		};

		const first = cache.resolve(params);
		const second = cache.resolve(params);

		expect(second).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first[0])).toBe(true);
		expect(Object.isFrozen(first[0]?.section)).toBe(true);
		expect(getSortedTagGroupItems).not.toHaveBeenCalled();

		const firstItems = first[0]?.getItems();
		expect(firstItems).toHaveLength(1);
		expect(first[0]?.getItems()).toBe(firstItems);
		expect(getSortedTagGroupItems).toHaveBeenCalledTimes(1);
		let counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.sectionDescriptorIdentityCache.miss"].count).toBe(1);
		expect(counters["twoHop.sectionDescriptorIdentityCache.hit"].count).toBe(1);

		cache.invalidate();
		expect(cache.resolve(params)).not.toBe(first);
		counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.sectionDescriptorIdentityCache.invalidate"].count).toBe(
			1,
		);
	});

	it("replaces only changed sections and scopes pagination keys", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const alpha = {
			tag: "alpha",
			notes: [createNote("alpha.md", "alpha")],
		};
		const beta = {
			tag: "beta",
			notes: [createNote("beta.md", "beta")],
		};
		const first = cache.resolve({
			...baseParams,
			displayData: createDisplayData([alpha, beta]),
		});
		const changedBeta = {
			tag: "beta",
			notes: [...beta.notes, createNote("beta-2.md", "beta")],
		};
		const changed = cache.resolve({
			...baseParams,
			displayData: createDisplayData([alpha, changedBeta]),
		});

		expect(changed).not.toBe(first);
		expect(changed[0]).toBe(first[0]);
		expect(changed[1]).not.toBe(first[1]);
		expect(changed[1]?.totalCount).toBe(2);

		const scoped = cache.resolve({
			...baseParams,
			searchQuery: "query",
			displayData: createDisplayData([alpha, changedBeta]),
		});
		expect(scoped[0]).not.toBe(changed[0]);
		expect(scoped.map((section) => section.sectionId)).toEqual(
			changed.map((section) => section.sectionId),
		);
		expect(scoped.map((section) => section.paginationKey)).not.toEqual(
			changed.map((section) => section.paginationKey),
		);
	});

	it("resolves tag getItem through the shared sorted item cache", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams, getSortedTagGroupItems } = createHarness();
		const alpha = {
			tag: "alpha",
			notes: [
				createNote("alpha-1.md", "alpha"),
				createNote("alpha-2.md", "alpha"),
			],
		};
		const [section] = cache.resolve({
			...baseParams,
			displayData: createDisplayData([alpha]),
		});

		expect(section?.getItem?.(0)?.virtualKey).toBeTruthy();
		expect(section?.getItem?.(1)?.virtualKey).toBeTruthy();
		expect(section?.getItems()).toHaveLength(2);
		expect(getSortedTagGroupItems).toHaveBeenCalledTimes(1);
	});

	it("materializes tag wrappers only for requested indexes", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const alpha = {
			tag: "alpha",
			notes: [
				createNote("alpha-1.md", "alpha"),
				createNote("alpha-2.md", "alpha"),
			],
		};
		const [section] = cache.resolve({
			...baseParams,
			displayData: createDisplayData([alpha]),
		});

		expect(section?.getItem?.(1)?.interactionId).toBe("i0");
		expect(section?.getItem?.(0)?.interactionId).toBe("i1");
	});

	it("resolves branch getItem through the shared sorted item cache", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams, getSortedTwoHopItems } = createHarness();
		const branch = createBranch("parent.md", [
			createLink("child-1.md"),
			createLink("child-2.md"),
		]);
		const [section] = cache.resolve({
			...baseParams,
			displayData: createDisplayData([], [branch]),
		});

		expect(section?.getItem?.(0)?.virtualKey).toBeTruthy();
		expect(section?.getItem?.(1)?.virtualKey).toBeTruthy();
		expect(section?.getItems()).toHaveLength(2);
		expect(getSortedTwoHopItems).toHaveBeenCalledTimes(1);
	});

	it("materializes branch wrappers only for requested indexes", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const branch = createBranch("parent.md", [
			createLink("child-1.md"),
			createLink("child-2.md"),
		]);
		const [section] = cache.resolve({
			...baseParams,
			displayData: createDisplayData([], [branch]),
		});

		expect(section?.getItem?.(1)?.interactionId).toBe("i0");
		expect(section?.getItem?.(0)?.interactionId).toBe("i1");
	});

	it("does not reset branch sorting for a render-only updateVersion change", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams, getSortedTwoHopItems } = createHarness();
		const branch = createBranch("parent.md", [createLink("child.md")]);
		const first = cache.resolve({
			...baseParams,
			displayData: createDisplayData([], [branch]),
		});
		first[0]?.getItem?.(0);

		baseParams.applicationStore.updateVersion += 1;
		const second = cache.resolve({
			...baseParams,
			displayData: createDisplayData([], [branch]),
		});
		second[0]?.getItem?.(0);

		expect(second[0]).toBe(first[0]);
		expect(getSortedTwoHopItems).toHaveBeenCalledTimes(1);
	});

	it("keeps descriptor identity for equivalent section values", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const alpha = {
			tag: "alpha",
			notes: [createNote("alpha.md", "alpha")],
		};
		const first = cache.resolve({
			...baseParams,
			displayData: createDisplayData([alpha]),
		});
		const equivalent = cache.resolve({
			...baseParams,
			displayData: createDisplayData([
				{
					tag: alpha.tag,
					notes: alpha.notes.map((note) => ({
						...note,
						file: note.file,
						commonTags: [...note.commonTags],
					})),
				},
			]),
		});

		expect(equivalent).toBe(first);
	});

	it("drops removed section entries instead of reusing stale descriptors", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const alpha = {
			tag: "alpha",
			notes: [createNote("alpha.md", "alpha")],
		};
		const first = cache.resolve({
			...baseParams,
			displayData: createDisplayData([alpha]),
		});
		cache.resolve({
			...baseParams,
			displayData: createDisplayData([]),
		});
		const restored = cache.resolve({
			...baseParams,
			displayData: createDisplayData([alpha]),
		});

		expect(restored[0]).not.toBe(first[0]);
	});
});
