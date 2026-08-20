import { render, screen, waitFor } from "@testing-library/svelte";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchableItemList from "../SearchableItemList.svelte";
import type { ViewItem } from "application/presenters";
import type { ListConfig } from "../types";
import type { LinkContext } from "ui/context/linkContext";
import type { ListViewState } from "features/list-view/model/ListViewState";
import type { ISortService } from "core/sorting";
import { filterSearchWorkerDatasetWithMatchDetails } from "features/search/searchWorkerFilter";

vi.mock("../ViewItemCard.svelte", async () => {
	const component = await import("./SearchableItemListItemStub.svelte");
	return { default: component.default };
});

vi.mock("obsidian", () => {
	class MockTFile {
		path = "";
		name = "";
		basename = "";
		extension = "md";
		parent: unknown = null;
		stat = { ctime: 0, mtime: 0, size: 0 };
	}

	return {
		TFile: MockTFile,
	};
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

vi.mock("ui/components/common/ListControls.svelte", async () => {
	const component = await import("./SearchableItemListListControlsStub.svelte");
	return { default: component.default };
});

vi.mock("features/card-grid/ui/FlatCardGrid.svelte", async () => {
	const component = await import("./SearchableItemListLinkListStub.svelte");
	return { default: component.default };
});

const mockBookmarksState = vi.hoisted(() => {
	const filePaths = new Set<string>();
	const orderedFilePaths: string[] = [];
	return {
		filePaths,
		orderedFilePaths,
		isBookmarked: vi.fn(
			(path: string | null | undefined) => !!path && filePaths.has(path),
		),
	};
});

vi.mock("ui/hooks/useBookmarks.svelte", () => ({
	useBookmarks: () => mockBookmarksState,
}));

vi.mock("features/search/useFileContentIndex.svelte", () => ({
	useFileContentIndex: () => ({
		hasMatch: vi.fn(() => false),
		isLoading: vi.fn(() => false),
		getFirstMatchPosition: vi.fn(() => undefined),
		forEachEntry: vi.fn(() => {}),
	}),
}));

vi.mock("ui/context/linkContext", () => ({
	setAppContext: vi.fn(),
	setLinkContext: vi.fn(),
	setLazyLoaderCache: vi.fn(),
}));

function createLinkContext(
	sourceFile: TFile,
	fileToLinktext: (
		file: TFile,
		sourcePath: string,
		omitMdExtension?: boolean,
	) => string,
): LinkContext {
	return {
		resolveFile: vi.fn(() => null),
		fileToLinktext,
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
				case "backlink":
					return item.data.sourceFile.path;
				case "taggedNote":
					return item.data.path;
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

describe("SearchableItemList", () => {
	beforeEach(() => {
		mockBookmarksState.filePaths.clear();
		mockBookmarksState.orderedFilePaths.length = 0;
	});

	it("renders filtered items in the order provided by list sorting", async () => {
		const sourceFile = createMockTFile("notes/source.md");
		const alphaFile = createMockTFile("notes/alpha.md");
		const betaFile = createMockTFile("notes/beta.md");
		const gammaFile = createMockTFile("notes/gamma.md");
		const deltaFile = createMockTFile("notes/delta.md");

		const items = [
			{ type: "file", data: betaFile },
			{ type: "file", data: gammaFile },
			{ type: "file", data: deltaFile },
			{ type: "file", data: alphaFile },
		] as ViewItem[];

		const applicationStore = {
			sortOption: "alphabetical",
			initialVisibleCount: 10,
			loadMoreIncrement: 10,
			settings: {},
			setSortOption: vi.fn(),
			updateVersion: 0,
		} as unknown as ListViewState;

		const sortService: ISortService = {
			sort(nextItems) {
				return [nextItems[2]!, nextItems[3]!, nextItems[0]!, nextItems[1]!];
			},
		};

		const linkContext = createLinkContext(
			sourceFile,
			(file: TFile) => file.basename,
		);
		const config: ListConfig<ViewItem> = {
			...createConfig(),
			searchEnabled: false,
		};

		render(SearchableItemList, {
			props: {
				items,
				config,
				linkContext,
				applicationStore,
				sortService,
				app: {} as never,
				autofocus: false,
			},
		});

		await waitFor(() =>
			expect(screen.getByTestId("filtered-count")).toHaveTextContent("4"),
		);

		const renderedItems = screen.getAllByTestId("searchable-item");
		expect(renderedItems).toHaveLength(4);
		expect(renderedItems[0]).toHaveAttribute("data-label", "delta");
		expect(renderedItems[1]).toHaveAttribute("data-label", "alpha");
		expect(renderedItems[2]).toHaveAttribute("data-label", "beta");
		expect(renderedItems[3]).toHaveAttribute("data-label", "gamma");
	});
});
