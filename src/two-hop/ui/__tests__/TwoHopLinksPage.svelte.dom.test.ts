import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "settings/model";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { TwoHopLinkResult } from "two-hop/model";
import TwoHopLinksPage from "../TwoHopLinksPage.svelte";

vi.mock("obsidian", () => {
	class TFile {
		path = "";
		name = "";
		basename = "";
		extension = "md";
		stat = { ctime: 0, mtime: 0, size: 0 };
		parent: unknown = null;
	}

	return {
		TFile,
		requireApiVersion: vi.fn(() => false),
		Platform: { isMobile: false },
	};
});

vi.mock("cards/hooks/useSearchQuery.svelte", () => ({
	useSearchQuery: () => ({
		value: "",
		normalized: "",
	}),
}));

vi.mock("cards/hooks/useBookmarks.svelte", () => ({
	useBookmarks: () => ({
		filePaths: new Set<string>(),
		orderedFilePaths: [],
		isBookmarked: () => false,
	}),
}));

vi.mock("cards/context/linkContext", () => ({
	setAppContext: vi.fn(),
	setLinkContext: vi.fn(),
	setLazyLoaderCache: vi.fn(),
}));

function createCardCollectionState() {
	return {
		initialVisibleCount: DEFAULT_SETTINGS.defaultVisibleLinkCount,
		loadMoreIncrement: DEFAULT_SETTINGS.loadMoreLinkIncrement,
		settings: DEFAULT_SETTINGS,
		sortOption: DEFAULT_SETTINGS.lastUsedSortOption,
		sectionExpandedLimits: {},
		updateVersion: 0,
		previewState: {
			globalVersion: 0,
			pathVersions: {},
			getRenderVersion: vi.fn(() => "0:0"),
		},
		setSortOption: vi.fn(),
		setContentSearchEnabled: vi.fn(),
		setSettings: vi.fn(),
		setSectionExpandedLimit: vi.fn(),
		getSectionExpandedLimit: vi.fn(() => undefined),
	};
}

describe("TwoHopLinksPage", () => {
	it("adds a keyboard navigation surface marker to the root element", async () => {
		const file = createMockTFile("target.md");
		const applicationStore = {
			uiState: createCardCollectionState(),
			loading: false,
			loadingPhase: "initial",
			data: undefined,
			displayState: {
				displayData: {
					outgoing: [],
					backlinks: [],
					mergedItems: [],
					twoHopBranches: [],
					tagGroups: [],
					newLinks: [],
				},
				hasDisplayableItems: false,
			},
			initialVisibleCount: DEFAULT_SETTINGS.defaultVisibleLinkCount,
			loadMoreIncrement: DEFAULT_SETTINGS.loadMoreLinkIncrement,
			settings: DEFAULT_SETTINGS,
			sortOption: DEFAULT_SETTINGS.lastUsedSortOption,
			setSortOption: vi.fn(),
			triggerUpdate: vi.fn(),
			updateVersion: 0,
		};

		const linkContext = {
			resolveFile: vi.fn(() => null),
			fileToLinktext: vi.fn(() => "target"),
			buildWikiLink: vi.fn(() => "[[target]]"),
			getPreview: vi.fn(async () => ({ type: "empty", content: "" }) as const),
			sourceFile: file,
			getMetadata: vi.fn(() => null),
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};

		const { container, rerender } = render(TwoHopLinksPage, {
			props: {
				file,
				linkContext,
				applicationStore,
				app: {} as never,
				lazyLoaderCache: new Set<string>(),
				isSidebar: false,
			} as any,
		});

		let root = container.querySelector(".cosense-card-links__root");
		expect(root).not.toBeNull();
		expect(root).toHaveAttribute("data-ccl-card-surface", "inline");
		expect(root).toHaveAttribute("tabindex", "-1");

		await rerender({
			file,
			linkContext,
			applicationStore,
			app: {} as never,
			lazyLoaderCache: new Set<string>(),
			isSidebar: true,
		} as any);

		root = container.querySelector(".cosense-card-links__root");
		expect(root).toHaveAttribute("data-ccl-card-surface", "sidebar");
	});

	it("displays LoadingState in card area while loading", () => {
		const file = createMockTFile("target.md");
		const applicationStore = {
			uiState: createCardCollectionState(),
			loading: true,
			loadingPhase: "initial",
			data: undefined,
			displayState: {
				displayData: {
					outgoing: [],
					backlinks: [],
					mergedItems: [],
					twoHopBranches: [],
					tagGroups: [],
					newLinks: [],
				},
				hasDisplayableItems: false,
			},
			initialVisibleCount: DEFAULT_SETTINGS.defaultVisibleLinkCount,
			loadMoreIncrement: DEFAULT_SETTINGS.loadMoreLinkIncrement,
			settings: DEFAULT_SETTINGS,
			sortOption: DEFAULT_SETTINGS.lastUsedSortOption,
			setSortOption: vi.fn(),
			triggerUpdate: vi.fn(),
			updateVersion: 0,
		};

		const linkContext = {
			resolveFile: vi.fn(() => null),
			fileToLinktext: vi.fn(() => "target"),
			buildWikiLink: vi.fn(() => "[[target]]"),
			getPreview: vi.fn(async () => ({ type: "empty", content: "" }) as const),
			sourceFile: file,
			getMetadata: vi.fn(() => null),
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};

		const { container } = render(TwoHopLinksPage, {
			props: {
				file,
				linkContext,
				applicationStore,
				app: {} as never,
				lazyLoaderCache: new Set<string>(),
				isSidebar: false,
			} as any,
		});

		const resultsContainer = container.querySelector(
			".cosense-card-links__results",
		);
		const loadingStatus = screen.getByRole("status");

		expect(resultsContainer).not.toBeNull();
		expect(resultsContainer?.contains(loadingStatus)).toBe(true);
		expect(
			screen.getByText("Waiting for the initial index to finish building."),
		).toBeInTheDocument();
	});

	it("maintains base results and displays two-hop placeholder during base-ready", () => {
		const file = createMockTFile("target.md");
		const linkResult: TwoHopLinkResult = {
			originFile: file as never,
			branches: [
				{
					hop1: {
						rawText: "linked",
						path: "linked.md",
						isUnresolved: false,
						sourceFile: file as never,
					},
					hop2: [],
				},
			],
			backlinks: [],
			taggedNotes: [],
		};
		const applicationStore = {
			uiState: createCardCollectionState(),
			loading: false,
			loadingPhase: "base-ready",
			data: linkResult,
			displayState: {
				displayData: {
					outgoing: [],
					backlinks: [],
					mergedItems: [],
					twoHopBranches: [],
					tagGroups: [],
					newLinks: [],
				},
				hasDisplayableItems: false,
			},
			initialVisibleCount: DEFAULT_SETTINGS.defaultVisibleLinkCount,
			loadMoreIncrement: DEFAULT_SETTINGS.loadMoreLinkIncrement,
			settings: DEFAULT_SETTINGS,
			sortOption: DEFAULT_SETTINGS.lastUsedSortOption,
			setSortOption: vi.fn(),
			triggerUpdate: vi.fn(),
			updateVersion: 0,
		};

		const linkContext = {
			resolveFile: vi.fn(() => null),
			fileToLinktext: vi.fn(() => "target"),
			buildWikiLink: vi.fn(() => "[[target]]"),
			getPreview: vi.fn(async () => ({ type: "empty", content: "" }) as const),
			sourceFile: file,
			getMetadata: vi.fn(() => null),
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};

		render(TwoHopLinksPage, {
			props: {
				file,
				linkContext,
				applicationStore,
				app: {} as never,
				lazyLoaderCache: new Set<string>(),
				isSidebar: false,
			} as any,
		});

		expect(screen.getByText("Loading two-hop links...")).toBeInTheDocument();
	});
});
