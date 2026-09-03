import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { TFile } from "obsidian";
import { Menu } from "testing/__mocks__/obsidianMocks";
import { CardCollectionState } from "cards/CardCollectionState.svelte";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchableItemList from "../SearchableItemList.svelte";
import type { CardItem } from "cards/CardItem";
import type { ListConfig } from "../types";
import type { LinkContext } from "cards/context/linkContext";
import type { ListViewState } from "cards/list/model/ListViewState";
import type { ISortService } from "cards/sorting";
import type { ListViewUiState } from "cards/list/model/listViewUiState";
import { DEFAULT_SETTINGS } from "settings/model";
import { ARIA_LABELS } from "cards/ariaLabels";
import { queryAllByRoleDeep } from "testing/helpers/shadowDomQueries";
import {
	installResizeObserverMock,
	resetRecords,
	setElementRect,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";

vi.mock("cards/hooks/useBookmarks.svelte", () => ({
	useBookmarks: () => ({
		filePaths: new Set<string>(),
		orderedFilePaths: [],
		isBookmarked: () => false,
	}),
}));

vi.mock("cards/context/linkContext", async () => {
	const actual = await vi.importActual<typeof import("cards/context/linkContext")>(
		"cards/context/linkContext",
	);

	return {
		...actual,
		setAppContext: actual.setAppContext,
		setLinkContext: vi.fn(),
		setLazyLoaderCache: vi.fn(),
	};
});

function createTaggedNoteItem(file: TFile): CardItem {
	return {
		type: "taggedNote",
		data: {
			file,
			commonTags: [],
			path: file.path,
		},
	};
}

function createLinkContext(sourceFile: TFile): LinkContext {
	return {
		resolveFile: vi.fn(() => null),
		fileToLinktext: vi.fn((file: TFile) => file.basename),
		buildWikiLink: vi.fn(() => "[[alpha]]"),
		getPreview: vi.fn(async () => ({ type: "empty", content: "" }) as const),
		sourceFile,
		getMetadata: vi.fn(() => null),
		onOpenFile: vi.fn(),
		onHop1Click: vi.fn(),
		onHop2Click: vi.fn(),
		onTagClick: vi.fn(),
	};
}

function createConfig(): ListConfig<CardItem> {
	return {
		title: "Searchable",
		getItemKey: (item: CardItem) => {
			switch (item.type) {
				case "taggedNote":
					return item.data.path;
				case "backlink":
					return item.data.sourceFile.path;
				case "file":
					return item.data.path;
				case "branch":
					return item.data.hop1.path ?? item.data.hop1.rawText;
				case "newLink":
					return (
						item.data.path ??
						`${item.data.sourceFile.path}:${item.data.rawText}`
					);
				default:
					return "";
			}
		},
		sectionId: "searchable-items",
		emptyMessage: "No items",
		searchEnabled: true,
	};
}

async function flushAsyncUi(): Promise<void> {
	await Promise.resolve();
	await tick();
	await vi.runOnlyPendingTimersAsync();
	await Promise.resolve();
	await tick();
	await Promise.resolve();
	await tick();
}

function getAllSearchableItems(): HTMLElement[] {
	const items = queryAllByRoleDeep("button", { name: / を開く$/ });
	if (items.length === 0) {
		throw new Error("Unable to find searchable items");
	}
	return items;
}

function querySearchableItem(label: string): HTMLElement | null {
	return (
		queryAllByRoleDeep("button", {
			name: ARIA_LABELS.OPEN_LINK(label),
		})[0] ?? null
	);
}

async function setGridViewportWidth(width: number): Promise<void> {
	await tick();
	const gridRoot = document.querySelector<HTMLElement>(
		".cosense-card-links__virtual-grid",
	);
	if (!gridRoot) {
		throw new Error("Unable to find searchable item grid");
	}

	setElementRect(gridRoot, { top: 0, width, height: 1000 });
	triggerResize(gridRoot, width, 1000);
	await flushAsyncUi();
}

function expectComposedFocus(element: HTMLElement): void {
	const root = element.getRootNode();
	expect(
		root instanceof ShadowRoot ? root.activeElement : document.activeElement,
	).toBe(element);
}

describe("SearchableItemList integration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetRecords();
		installResizeObserverMock();
	});

	afterEach(() => {
		teardownResizeObserverMock();
		vi.useRealTimers();
	});

	it("restores relevance only for origin collections and uses modified order in other views", async () => {
		const sourceFile = createMockTFile("source.md");
		const items = [
			createTaggedNoteItem(createMockTFile("a.md")),
			createTaggedNoteItem(createMockTFile("b.md")),
		];
		const applicationStore = new CardCollectionState(
			{ ...DEFAULT_SETTINGS, lastUsedSortOption: "relevance" },
			vi.fn(),
		);
		const sortService: ISortService = {
			sort: vi.fn((nextItems) => [...nextItems].reverse()),
		};
		const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
		const config = createConfig();
		const view = render(SearchableItemList, {
			props: {
				items,
				config,
				linkContext: createLinkContext(sourceFile),
				applicationStore,
				sortService,
				app: {} as never,
				autofocus: false,
			},
		});
		await flushAsyncUi();
		expect(sortService.sort).toHaveBeenLastCalledWith(
			expect.any(Array),
			"modified-date-reverse",
		);
		const trigger = screen.getByRole("button", { name: ARIA_LABELS.SORT_SELECT });
		expect(trigger).toHaveTextContent("更新日時");
		await fireEvent.click(trigger);
		expect(
			showAtPosition.mock.contexts[0].items.some(
				(item) => item.title === "関連度",
			),
		).toBe(false);

		await view.rerender({ config: { ...config, allowRelevanceSort: true } });
		await flushAsyncUi();
		expect(trigger).toHaveTextContent("関連度");
		expect(sortService.sort).toHaveBeenLastCalledWith(
			expect.any(Array),
			"modified-date-reverse",
		);
		expect(applicationStore.sortOption).toBe("relevance");
		const relevanceDirection = screen.getByRole("button", {
			name: "関連度の高い順（クリックで低い順に切り替え）",
		});
		expect(relevanceDirection).toBeEnabled();
		expect(
			getAllSearchableItems().map((item) => item.getAttribute("aria-label")),
		).toEqual([ARIA_LABELS.OPEN_LINK("b"), ARIA_LABELS.OPEN_LINK("a")]);
		await fireEvent.click(relevanceDirection);
		await flushAsyncUi();
		expect(applicationStore.sortOption).toBe("relevance-reverse");
		expect(sortService.sort).toHaveBeenLastCalledWith(
			expect.any(Array),
			"modified-date",
		);
		view.unmount();
		applicationStore.destroy();
		showAtPosition.mockRestore();
	});

	it("filters via the real search input flow without relying on mocked bindings", async () => {
		const sourceFile = createMockTFile("notes/source.md");
		const items = [
			createTaggedNoteItem(createMockTFile("notes/alpha-note.md")),
			createTaggedNoteItem(createMockTFile("notes/beta-note.md")),
		] as CardItem[];
		const expandedLimits = new Map<string, number>();
		const applicationStore = {
			sortOption: "alphabetical",
			initialVisibleCount: 10,
			loadMoreIncrement: 10,
			settings: DEFAULT_SETTINGS,
			setSortOption: vi.fn(),
			getDefaultSectionVisibleLimit: vi.fn(() => 10),
			getSectionExpandedLimit: vi.fn((sectionId: string) =>
				expandedLimits.get(sectionId),
			),
			setSectionExpandedLimit: vi.fn((sectionId: string, limit: number) => {
				expandedLimits.set(sectionId, limit);
			}),
			previewState: {
				globalVersion: 0,
				pathVersions: {},
				getRenderVersion: () => "0:0",
			},
			updateVersion: 0,
		} as unknown as ListViewState;
		const sortService: ISortService = {
			sort: vi.fn((nextItems) => nextItems),
		};

		render(SearchableItemList, {
			props: {
				items,
				config: createConfig(),
				linkContext: createLinkContext(sourceFile),
				applicationStore,
				sortService,
				app: {} as never,
				autofocus: false,
			},
		});

		await flushAsyncUi();
		expect(getAllSearchableItems()).toHaveLength(2);

		const input = screen.getByRole("searchbox");
		await fireEvent.input(input, { target: { value: "alpha" } });
		await vi.advanceTimersByTimeAsync(200);
		await flushAsyncUi();

		await waitFor(() => expect(getAllSearchableItems()).toHaveLength(1));
		expect(querySearchableItem("alpha-note")).toBeInTheDocument();
		expect(querySearchableItem("beta-note")).not.toBeInTheDocument();
	});

	it("appends progressive matches without remounting cards already shown", async () => {
		const sourceFile = createMockTFile("notes/source.md");
		const items = Array.from({ length: 11 }, (_unused, index) =>
			createTaggedNoteItem(
				createMockTFile(`notes/alpha-${String(index).padStart(2, "0")}.md`),
			),
		);
		const expandedLimits = new Map<string, number>();
		const applicationStore = {
			sortOption: "alphabetical",
			initialVisibleCount: 20,
			loadMoreIncrement: 20,
			settings: { ...DEFAULT_SETTINGS, enableContentSearch: false },
			setSortOption: vi.fn(),
			setContentSearchEnabled: vi.fn(),
			getDefaultSectionVisibleLimit: vi.fn(() => 20),
			getSectionExpandedLimit: vi.fn((sectionId: string) =>
				expandedLimits.get(sectionId),
			),
			setSectionExpandedLimit: vi.fn((sectionId: string, limit: number) => {
				expandedLimits.set(sectionId, limit);
			}),
			previewState: {
				globalVersion: 0,
				pathVersions: {},
				getRenderVersion: () => "0:0",
			},
			updateVersion: 0,
		} as unknown as ListViewState;
		const sortService: ISortService = {
			sort: vi.fn((sortableItems) => sortableItems),
		};
		const app = {
			vault: { cachedRead: vi.fn(async () => "") },
		} as never;
		let idleCallback: IdleRequestCallback | undefined;
		const requestIdle = vi
			.spyOn(window, "requestIdleCallback")
			.mockImplementation((callback) => {
				idleCallback = callback;
				return 77;
			});
		const cancelIdle = vi
			.spyOn(window, "cancelIdleCallback")
			.mockImplementation(() => {});
		let clock = 0;
		const performanceNow = vi
			.spyOn(performance, "now")
			.mockImplementation(() => (clock += 6));

		render(SearchableItemList, {
			props: {
				items,
				config: { ...createConfig(), showSectionHeader: true },
				linkContext: createLinkContext(sourceFile),
				applicationStore,
				sortService,
				app,
				autofocus: false,
				uiState: {
					searchInputValue: "alpha",
				} as ListViewUiState,
			},
		});
		for (let index = 0; index < 5; index += 1) {
			await Promise.resolve();
			await tick();
			await vi.advanceTimersByTimeAsync(0);
		}
		expect(idleCallback).toBeDefined();
		const gridRoot = document.querySelector<HTMLElement>(
			".cosense-card-links__virtual-grid",
		);
		if (!gridRoot) throw new Error("Unable to find progressive result grid");
		setElementRect(gridRoot, { top: 0, width: 1600, height: 1000 });
		triggerResize(gridRoot, 1600, 1000);
		for (let frame = 0; frame < 3; frame += 1) {
			await vi.advanceTimersByTimeAsync(16);
			await tick();
		}

		const firstPublicationElements = getAllSearchableItems();
		const firstPublicationCells = firstPublicationElements.map((item) =>
			item.closest<HTMLElement>("[data-ccl-cell-slot]"),
		);
		const firstPublication = firstPublicationElements.map((item) =>
			item.getAttribute("aria-label"),
		);
		expect(firstPublication.length).toBeGreaterThan(0);
		expect(firstPublication).not.toContain(ARIA_LABELS.OPEN_LINK("alpha-10"));
		expect(queryAllByRoleDeep("button", { name: "10 notes" })).toHaveLength(1);

		idleCallback?.({
			didTimeout: false,
			timeRemaining: () => 10,
		} as IdleDeadline);
		await Promise.resolve();
		await tick();
		await vi.advanceTimersByTimeAsync(16);
		await tick();

		const finalPublicationElements = getAllSearchableItems();
		const finalPublication = finalPublicationElements.map((item) =>
			item.getAttribute("aria-label"),
		);
		expect(finalPublication.slice(0, firstPublication.length)).toEqual(
			firstPublication,
		);
		for (let index = 0; index < firstPublicationElements.length; index += 1) {
			expect(
				finalPublicationElements[index]?.closest("[data-ccl-cell-slot]"),
			).toBe(firstPublicationCells[index]);
			expect(finalPublicationElements[index]).toBe(
				firstPublicationElements[index],
			);
		}
		expect(queryAllByRoleDeep("button", { name: "11 notes" })).toHaveLength(1);

		performanceNow.mockRestore();
		requestIdle.mockRestore();
		cancelIdle.mockRestore();
	});

	it("restores and persists the search input through list UI state", async () => {
		const sourceFile = createMockTFile("notes/source.md");
		const items = [
			createTaggedNoteItem(createMockTFile("notes/alpha-note.md")),
			createTaggedNoteItem(createMockTFile("notes/beta-note.md")),
		] as CardItem[];
		const uiState: ListViewUiState = { searchInputValue: "alpha" };
		const applicationStore = {
			sortOption: "alphabetical",
			initialVisibleCount: 10,
			loadMoreIncrement: 10,
			settings: DEFAULT_SETTINGS,
			setSortOption: vi.fn(),
			setContentSearchEnabled: vi.fn(),
			previewState: {
				globalVersion: 0,
				pathVersions: {},
				getRenderVersion: () => "0:0",
			},
			updateVersion: 0,
		} as unknown as ListViewState;
		const sortService: ISortService = {
			sort: vi.fn((nextItems) => nextItems),
		};

		render(SearchableItemList, {
			props: {
				items,
				config: createConfig(),
				linkContext: createLinkContext(sourceFile),
				applicationStore,
				sortService,
				app: {} as never,
				autofocus: false,
				uiState,
			},
		});

		await flushAsyncUi();
		expect(screen.getByRole("searchbox")).toHaveValue("alpha");
		await waitFor(() => expect(getAllSearchableItems()).toHaveLength(1));

		uiState.scrollState = { localScrollTop: 200, visibleCount: 20 };
		await fireEvent.input(screen.getByRole("searchbox"), {
			target: { value: "beta" },
		});
		expect(uiState.searchInputValue).toBe("beta");
		expect(uiState.scrollState).toBeUndefined();
	});

	it("renders cards in the order returned by the sort service", async () => {
		const sourceFile = createMockTFile("notes/source.md");
		const items = ["beta", "gamma", "delta", "alpha"].map((name) =>
			createTaggedNoteItem(createMockTFile(`notes/${name}.md`)),
		);
		const expandedLimits = new Map<string, number>();
		const applicationStore = {
			sortOption: "alphabetical",
			initialVisibleCount: 10,
			loadMoreIncrement: 10,
			settings: DEFAULT_SETTINGS,
			setSortOption: vi.fn(),
			getDefaultSectionVisibleLimit: vi.fn(() => 10),
			getSectionExpandedLimit: vi.fn((sectionId: string) =>
				expandedLimits.get(sectionId),
			),
			setSectionExpandedLimit: vi.fn((sectionId: string, limit: number) => {
				expandedLimits.set(sectionId, limit);
			}),
			previewState: {
				globalVersion: 0,
				pathVersions: {},
				getRenderVersion: () => "0:0",
			},
			updateVersion: 0,
		} as unknown as ListViewState;
		const sortService: ISortService = {
			sort: vi.fn((nextItems) => [
				nextItems[2]!,
				nextItems[3]!,
				nextItems[0]!,
				nextItems[1]!,
			]),
		};

		render(SearchableItemList, {
			props: {
				items,
				config: { ...createConfig(), searchEnabled: false },
				linkContext: createLinkContext(sourceFile),
				applicationStore,
				sortService,
				app: {} as never,
				autofocus: false,
			},
		});

		await setGridViewportWidth(1600);

		expect(
			getAllSearchableItems().map((item) => item.getAttribute("aria-label")),
		).toEqual([
			ARIA_LABELS.OPEN_LINK("delta"),
			ARIA_LABELS.OPEN_LINK("alpha"),
			ARIA_LABELS.OPEN_LINK("beta"),
			ARIA_LABELS.OPEN_LINK("gamma"),
		]);
	});

	it("moves focus between the search input and visible result cards", async () => {
		const sourceFile = createMockTFile("notes/source.md");
		const items = [
			createTaggedNoteItem(createMockTFile("notes/alpha-note.md")),
			createTaggedNoteItem(createMockTFile("notes/beta-note.md")),
		] as CardItem[];
		const expandedLimits = new Map<string, number>();
		const applicationStore = {
			sortOption: "alphabetical",
			initialVisibleCount: 10,
			loadMoreIncrement: 10,
			settings: DEFAULT_SETTINGS,
			setSortOption: vi.fn(),
			getDefaultSectionVisibleLimit: vi.fn(() => 10),
			getSectionExpandedLimit: vi.fn((sectionId: string) =>
				expandedLimits.get(sectionId),
			),
			setSectionExpandedLimit: vi.fn((sectionId: string, limit: number) => {
				expandedLimits.set(sectionId, limit);
			}),
			previewState: {
				globalVersion: 0,
				pathVersions: {},
				getRenderVersion: () => "0:0",
			},
			updateVersion: 0,
		} as unknown as ListViewState;
		const sortService: ISortService = {
			sort: vi.fn((nextItems) => nextItems),
		};

		render(SearchableItemList, {
			props: {
				items,
				config: createConfig(),
				linkContext: createLinkContext(sourceFile),
				applicationStore,
				sortService,
				app: {} as never,
				autofocus: false,
			},
		});

		await flushAsyncUi();
		await waitFor(() => expect(getAllSearchableItems()).toHaveLength(2));
		const input = screen.getByRole("searchbox");
		await fireEvent.keyDown(input, { key: "ArrowDown" });
		await flushAsyncUi();

		const firstItem = getAllSearchableItems()[0];
		expectComposedFocus(firstItem);

		const secondItem = getAllSearchableItems()[1];
		await fireEvent.keyDown(firstItem, { key: "ArrowDown" });
		await flushAsyncUi();
		expectComposedFocus(secondItem);

		firstItem.focus();
		await fireEvent.keyDown(firstItem, { key: "ArrowUp" });
		await flushAsyncUi();
		expect(input).toHaveFocus();
	});
});
