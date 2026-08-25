import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchableItemList from "../SearchableItemList.svelte";
import type { CardItem } from "cards/CardItem";
import type { ListConfig } from "../types";
import type { LinkContext } from "cards/context/linkContext";
import type { ListViewState } from "cards/list/model/ListViewState";
import type { ISortService } from "cards/sorting";
import type { ListViewUiState } from "cards/list/model/listViewUiState";
import { filterSearchWorkerDatasetWithMatchDetails } from "search/searchWorkerFilter";
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

vi.mock("search/searchWorkerClient", async () => {
	const { filterSearchWorkerDatasetWithMatchDetails } =
		await import("search/searchWorkerFilter");

	return {
		createSearchWorkerClient: (onMessage: (message: unknown) => void) => {
			let snapshot = {
				datasetVersion: 0,
				items: [],
				fileContents: [],
			};
			let contentByPath = new Map<string, string>();

			return {
				syncItems: (nextSnapshot: typeof snapshot) => {
					snapshot = {
						...snapshot,
						datasetVersion: nextSnapshot.datasetVersion,
						items: nextSnapshot.items,
					};
				},
				upsertFileContents: (update: {
					datasetVersion: number;
					entries: Array<{ path: string; content: string }>;
				}) => {
					snapshot = {
						...snapshot,
						datasetVersion: update.datasetVersion,
					};
					for (const entry of update.entries) {
						contentByPath.set(entry.path, entry.content);
					}
				},
				removeFileContents: (update: {
					datasetVersion: number;
					paths: string[];
				}) => {
					snapshot = {
						...snapshot,
						datasetVersion: update.datasetVersion,
					};
					for (const path of update.paths) {
						contentByPath.delete(path);
					}
				},
				filter: (request: {
					requestId: number;
					datasetVersion: number;
					query: string;
					matchScope?: "title-only" | "title-and-content";
				}) => {
					onMessage({
						type: "filter-result",
						requestId: request.requestId,
						datasetVersion: request.datasetVersion,
						matchedItems: filterSearchWorkerDatasetWithMatchDetails(
							snapshot,
							request.query,
							request.matchScope,
							contentByPath,
						),
					});
				},
				terminate: vi.fn(),
			};
		},
	};
});

vi.mock("cards/hooks/useBookmarks.svelte", () => ({
	useBookmarks: () => ({
		filePaths: new Set<string>(),
		orderedFilePaths: [],
		isBookmarked: () => false,
	}),
}));

vi.mock("search/useFileContentIndex.svelte", () => ({
	useFileContentIndex: () => ({
		hasMatch: vi.fn(() => false),
		isLoading: vi.fn(() => false),
		getFirstMatchPosition: vi.fn(() => undefined),
		forEachEntry: vi.fn(() => {}),
	}),
}));

vi.mock("cards/context/linkContext", async () => {
	const actual = await vi.importActual<typeof import("cards/context/linkContext")>(
		"cards/context/linkContext",
	);

	return {
		...actual,
		setAppContext: vi.fn(),
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
