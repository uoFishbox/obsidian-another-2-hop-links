import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchableItemList from "../SearchableItemList.svelte";
import type { ViewItem } from "application/presenters";
import type { ListConfig } from "../types";
import type { LinkContext } from "ui/context/linkContext";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { ISortService } from "core/sorting";
import { filterSearchWorkerDatasetWithMatchDetails } from "features/search/searchWorkerFilter";

vi.mock("ui/components/items/ViewItemCard.svelte", async () => {
	const component = await import("./SearchableItemListItemStub.svelte");
	return { default: component.default };
});

vi.mock("features/search/searchWorkerClient", async () => {
	const { filterSearchWorkerDatasetWithMatchDetails } =
		await import("features/search/searchWorkerFilter");

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

vi.mock("ui/hooks/useBookmarks.svelte", () => ({
	useBookmarks: () => ({
		filePaths: new Set<string>(),
		orderedFilePaths: [],
		isBookmarked: () => false,
	}),
}));

vi.mock("features/search/useFileContentIndex.svelte", () => ({
	useFileContentIndex: () => ({
		hasMatch: vi.fn(() => false),
		isLoading: vi.fn(() => false),
		getFirstMatchPosition: vi.fn(() => undefined),
		forEachEntry: vi.fn(() => {}),
	}),
}));

vi.mock("ui/context/linkContext", async () => {
	const actual = await vi.importActual<typeof import("ui/context/linkContext")>(
		"ui/context/linkContext",
	);

	return {
		...actual,
		setAppContext: vi.fn(),
		setLinkContext: vi.fn(),
		setLazyLoaderCache: vi.fn(),
	};
});

function createTaggedNoteItem(file: TFile): ViewItem {
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

function createConfig(): ListConfig<ViewItem> {
	return {
		title: "Searchable",
		getItemKey: (item: ViewItem) => {
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

function collectOpenShadowRoots(root: ParentNode = document): ShadowRoot[] {
	const shadowRoots: ShadowRoot[] = [];
	for (const element of Array.from(root.querySelectorAll("*"))) {
		if (!(element instanceof HTMLElement) || !element.shadowRoot) {
			continue;
		}

		shadowRoots.push(element.shadowRoot);
		shadowRoots.push(...collectOpenShadowRoots(element.shadowRoot));
	}
	return shadowRoots;
}

function queryAllByTestIdIncludingShadow(testId: string): HTMLElement[] {
	const elements = screen.queryAllByTestId(testId) as HTMLElement[];
	for (const shadowRoot of collectOpenShadowRoots()) {
		elements.push(
			...(within(shadowRoot as unknown as HTMLElement).queryAllByTestId(
				testId,
			) as HTMLElement[]),
		);
	}
	return elements;
}

function getAllSearchableItems(): HTMLElement[] {
	const items = queryAllByTestIdIncludingShadow("searchable-item");
	if (items.length === 0) {
		throw new Error("Unable to find searchable items");
	}
	return items;
}

function queryByTextIncludingShadow(text: string): HTMLElement | null {
	const element = screen.queryByText(text) as HTMLElement | null;
	if (element) {
		return element;
	}

	for (const shadowRoot of collectOpenShadowRoots()) {
		const shadowElement = within(shadowRoot as unknown as HTMLElement).queryByText(
			text,
		) as HTMLElement | null;
		if (shadowElement) {
			return shadowElement;
		}
	}
	return null;
}

function getByTextIncludingShadow(text: string): HTMLElement {
	const element = queryByTextIncludingShadow(text);
	if (!element) {
		throw new Error(`Unable to find text: ${text}`);
	}
	return element;
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
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("filters via the real search input flow without relying on mocked bindings", async () => {
		const sourceFile = createMockTFile("notes/source.md");
		const items = [
			createTaggedNoteItem(createMockTFile("notes/alpha-note.md")),
			createTaggedNoteItem(createMockTFile("notes/beta-note.md")),
		] as ViewItem[];
		const expandedLimits = new Map<string, number>();
		const applicationStore = {
			sortOption: "alphabetical",
			initialVisibleCount: 10,
			loadMoreIncrement: 10,
			settings: {},
			setSortOption: vi.fn(),
			getDefaultSectionVisibleLimit: vi.fn(() => 10),
			getSectionExpandedLimit: vi.fn((sectionId: string) =>
				expandedLimits.get(sectionId),
			),
			setSectionExpandedLimit: vi.fn((sectionId: string, limit: number) => {
				expandedLimits.set(sectionId, limit);
			}),
			updateVersion: 0,
		} as unknown as ApplicationStore;
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
		expect(getByTextIncludingShadow("alpha-note")).toBeInTheDocument();
		expect(queryByTextIncludingShadow("beta-note")).not.toBeInTheDocument();
	});

	it("moves focus between the search input and visible result cards", async () => {
		const sourceFile = createMockTFile("notes/source.md");
		const items = [
			createTaggedNoteItem(createMockTFile("notes/alpha-note.md")),
			createTaggedNoteItem(createMockTFile("notes/beta-note.md")),
		] as ViewItem[];
		const expandedLimits = new Map<string, number>();
		const applicationStore = {
			sortOption: "alphabetical",
			initialVisibleCount: 10,
			loadMoreIncrement: 10,
			settings: {},
			setSortOption: vi.fn(),
			getDefaultSectionVisibleLimit: vi.fn(() => 10),
			getSectionExpandedLimit: vi.fn((sectionId: string) =>
				expandedLimits.get(sectionId),
			),
			setSectionExpandedLimit: vi.fn((sectionId: string, limit: number) => {
				expandedLimits.set(sectionId, limit);
			}),
			updateVersion: 0,
		} as unknown as ApplicationStore;
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
