import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { DisplayData } from "features/two-hop/application/displayDataBuilder";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { TaggedNote, TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import { createTwoHopSectionDescriptorIdentityCache } from "features/two-hop/ui/section-descriptors/cache";
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
	it("reuses an eagerly materialized immutable descriptor output", () => {
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
		expect(getSortedTagGroupItems).toHaveBeenCalledTimes(1);

		const firstItems = first[0]?.getItems();
		expect(firstItems).toHaveLength(1);
		expect(first[0]?.getItems()).toBe(firstItems);
		expect(getSortedTagGroupItems).toHaveBeenCalledTimes(1);
		let counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.sectionDescriptorIdentityCache.miss"].count).toBe(1);
		expect(counters["twoHop.sectionDescriptorIdentityCache.hit"].count).toBe(1);
		expect(counters["twoHop.sectionDescriptorIdentityCache.exactHit"].count).toBe(
			1,
		);
	});

	it("skips section traversal when every resolve input is unchanged", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const branch = createBranch("parent.md", [createLink("child.md")]);
		const params = {
			...baseParams,
			displayData: createDisplayData([], [branch]),
		};

		const first = cache.resolve(params);
		const second = cache.resolve(params);

		expect(second).toBe(first);
		expect(baseParams.resolveFile).toHaveBeenCalledTimes(1);
	});

	it("does not use the exact fast path after a sort context change", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const branch = createBranch("parent.md", [createLink("child.md")]);
		const params = {
			...baseParams,
			displayData: createDisplayData([], [branch]),
		};
		let sortContextVersion = 0;
		baseParams.applicationStore.getSortContextVersion = () => sortContextVersion;

		const first = cache.resolve(params);
		sortContextVersion += 1;
		const second = cache.resolve(params);

		expect(second[0]).not.toBe(first[0]);
		expect(baseParams.resolveFile).toHaveBeenCalledTimes(2);
	});

	it("replaces only changed section publications", () => {
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

	it("materializes tag wrappers in sorted order during descriptor creation", () => {
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

		expect(section?.getItem?.(0)?.interactionId).toBe("i0");
		expect(section?.getItem?.(1)?.interactionId).toBe("i1");
	});

	it("eagerly resolves branch rows through the shared sorted item cache", () => {
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

		expect(getSortedTwoHopItems).toHaveBeenCalledTimes(1);
		expect(section?.getItem?.(0)?.virtualKey).toBeTruthy();
		expect(section?.getItem?.(1)?.virtualKey).toBeTruthy();
		expect(section?.getItems()).toHaveLength(2);
		expect(getSortedTwoHopItems).toHaveBeenCalledTimes(1);
	});

	it("materializes branch wrappers in sorted order during descriptor creation", () => {
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

		expect(section?.getItem?.(0)?.interactionId).toBe("i0");
		expect(section?.getItem?.(1)?.interactionId).toBe("i1");
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

		expect(equivalent).not.toBe(first);
		expect(equivalent[0]).toBe(first[0]);
	});

	it("ignores render-only version and layout-setting changes", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const alpha = {
			tag: "alpha",
			notes: [createNote("alpha.md", "alpha")],
		};
		const params = {
			...baseParams,
			displayData: createDisplayData([alpha]),
		};
		const first = cache.resolve(params);

		baseParams.applicationStore.updateVersion += 1;
		const second = cache.resolve({
			...params,
			currentSettings: {
				...params.currentSettings,
				cardWidthPx: params.currentSettings.cardWidthPx + 10,
			},
		});

		expect(second).toBe(first);
		expect(second[0]).toBe(first[0]);
	});

	it("uses the latest tag callback without replacing the descriptor", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const alpha = {
			tag: "alpha",
			notes: [createNote("alpha.md", "alpha")],
		};
		const firstCallback = vi.fn();
		const secondCallback = vi.fn();
		const params = {
			...baseParams,
			onTagClick: firstCallback,
			displayData: createDisplayData([alpha]),
		};
		const first = cache.resolve(params);
		const second = cache.resolve({
			...params,
			onTagClick: secondCallback,
		});

		expect(second).toBe(first);
		second[0]?.headerProps.onClick?.();
		expect(firstCallback).not.toHaveBeenCalled();
		expect(secondCallback).toHaveBeenCalledWith("alpha");
	});

	it("replaces a branch when interaction settings change", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const branch = createBranch("parent.md", [createLink("child.md")]);
		const params = {
			...baseParams,
			displayData: createDisplayData([], [branch]),
		};
		const first = cache.resolve(params);
		const firstInteractionId = first[0]?.getItem?.(0)?.interactionId;
		const second = cache.resolve({
			...params,
			currentSettings: {
				...params.currentSettings,
				mobileLongPressAction:
					params.currentSettings.mobileLongPressAction === "menu"
						? "preview"
						: "menu",
			},
		});

		expect(second[0]).not.toBe(first[0]);
		expect(second[0]?.getItem?.(0)?.interactionId).toBe(firstInteractionId);
	});

	it("reuses primary and new-links publications across equivalent render updates", () => {
		const cache = createTwoHopSectionDescriptorIdentityCache();
		const { baseParams } = createHarness();
		const outgoing = createBranch("parent.md", [createLink("child.md")]);
		const newLink = {
			...createLink("missing.md"),
			isUnresolved: true,
		};
		const displayData: DisplayData = {
			...createDisplayData([]),
			outgoing: [outgoing],
			newLinks: [newLink],
		};
		const first = cache.resolve({
			...baseParams,
			showTags: false,
			displayData,
		});

		baseParams.applicationStore.updateVersion += 1;
		const equivalent = cache.resolve({
			...baseParams,
			showTags: false,
			displayData: {
				...displayData,
				outgoing: [
					{
						hop1: { ...outgoing.hop1 },
						hop2: outgoing.hop2.map((item) => ({ ...item })),
					},
				],
				newLinks: [{ ...newLink }],
			},
		});

		expect(equivalent).not.toBe(first);
		expect(equivalent[0]).toBe(first[0]);
		expect(equivalent[1]).toBe(first[1]);
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
