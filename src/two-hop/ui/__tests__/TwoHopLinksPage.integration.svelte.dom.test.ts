import { fireEvent, render } from "@testing-library/svelte";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { tick, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "settings/model";
import type { TagGroup, TwoHopLinkBranch, TwoHopLinkResult } from "two-hop/model";
import type { TaggedNote, IndexedLink } from "indexing/model";
import type { DisplayData } from "two-hop/display/displayDataBuilder";
import TwoHopLinksPage from "../TwoHopLinksPage.svelte";
import { createKeyboardNavigationSurfaceRegistry } from "obsidian-integration/navigation/keyboardNavigationSurface";
import {
	installAnimationFrameMock,
	installIntersectionObserverMock,
	installResizeObserverMock,
	resetRecords,
	setElementRect,
	setNumericProperty,
	teardownAnimationFrameMock,
	teardownIntersectionObserverMock,
	teardownResizeObserverMock,
	triggerIntersection,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import {
	createPreviewRuntime,
	type PreviewRuntime,
} from "card-preview/runtime/previewRuntime";
import { CardCollectionState } from "cards/CardCollectionState.svelte";
import { ARIA_LABELS } from "cards/ariaLabels";
import {
	queryAllByRoleDeep,
	queryAllByTextDeep,
} from "testing/helpers/shadowDomQueries";

const previewRuntimes = new Set<PreviewRuntime>();

const searchResponseHarness = vi.hoisted(() => {
	let held = false;
	let pendingResponse: (() => void) | null = null;
	return {
		get held() {
			return held;
		},
		hold() {
			held = true;
		},
		queue(response: () => void) {
			pendingResponse = response;
		},
		release() {
			held = false;
			pendingResponse?.();
			pendingResponse = null;
		},
		reset() {
			held = false;
			pendingResponse = null;
		},
	};
});

vi.mock("search/streamingSearch", async () => {
	const actual = await vi.importActual<typeof import("search/streamingSearch")>(
		"search/streamingSearch",
	);
	return {
		...actual,
		runStreamingSearch: async (
			options: Parameters<typeof actual.runStreamingSearch>[0],
		) => {
			if (searchResponseHarness.held) {
				await new Promise<void>((resolve) =>
					searchResponseHarness.queue(resolve),
				);
			}
			return actual.runStreamingSearch(options);
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

function createBacklink(
	sourceFile: TFile,
	rawText: string = sourceFile.basename,
): IndexedLink {
	return {
		sourceFile,
		rawText,
		path: sourceFile.path,
		isUnresolved: false,
		backlinkCount: 0,
	} as IndexedLink;
}

function createBranch(
	originFile: TFile,
	targetFile: TFile,
	childFiles: TFile[],
	rawText: string = targetFile.basename,
): TwoHopLinkBranch {
	return {
		hop1: {
			sourceFile: originFile,
			rawText,
			path: targetFile.path,
			isUnresolved: false,
		},
		hop2: childFiles.map((childFile) => createBacklink(childFile)),
	};
}

function createTaggedNote(file: TFile, tag: string): TaggedNote {
	return {
		file,
		commonTags: [tag],
		path: file.path,
	};
}

function createDisplayData(): DisplayData {
	return {
		outgoing: [],
		backlinks: [],
		mergedItems: [],
		twoHopBranches: [],
		tagGroups: [],
		newLinks: [],
	};
}

function createTwoHopState(
	displayData: DisplayData,
	settings: typeof DEFAULT_SETTINGS,
	originFile: TFile,
) {
	const linkResult: TwoHopLinkResult = {
		originFile,
		branches: [...displayData.outgoing, ...displayData.twoHopBranches],
		backlinks: displayData.backlinks,
		taggedNotes: displayData.tagGroups.flatMap((section) => section.notes),
	};
	const uiState = new CardCollectionState(settings, vi.fn(), vi.fn());

	return {
		loading: false,
		loadingPhase: "complete" as const,
		data: linkResult,
		displayState: {
			displayData,
			hasDisplayableItems: true,
		},
		uiState,
		getSortedTwoHopItems: vi.fn((items: IndexedLink[]) => items),
		getSortedTagGroupItems: vi.fn((items: TaggedNote[]) => items),
	};
}

function collectFiles(originFile: TFile, displayData: DisplayData): Map<string, TFile> {
	const files = new Map<string, TFile>([[originFile.path, originFile]]);
	const addFile = (file: TFile | null | undefined) => {
		if (file) {
			files.set(file.path, file);
		}
	};

	for (const branch of displayData.outgoing) {
		if (branch.hop1.path) {
			addFile(createMockTFile(branch.hop1.path));
		}
	}
	for (const link of displayData.backlinks) {
		addFile(link.sourceFile);
	}
	for (const item of displayData.mergedItems) {
		if ("hop1" in item && item.hop1.path) {
			addFile(createMockTFile(item.hop1.path));
		}
		if ("sourceFile" in item) {
			addFile(item.sourceFile);
		}
	}
	for (const branch of displayData.twoHopBranches) {
		if (branch.hop1.path) {
			addFile(createMockTFile(branch.hop1.path));
		}
		for (const link of branch.hop2) {
			addFile(link.sourceFile);
		}
	}
	for (const section of displayData.tagGroups) {
		for (const note of section.notes) {
			addFile(note.file);
		}
	}

	return files;
}

function createRootProps(
	displayData: DisplayData,
	settings: typeof DEFAULT_SETTINGS,
	originFile: TFile,
): ComponentProps<typeof TwoHopLinksPage> {
	const filesByPath = collectFiles(originFile, displayData);
	const applicationStore = createTwoHopState(displayData, settings, originFile);
	const linkContext = {
		resolveFile: vi.fn((path: string) => filesByPath.get(path) ?? null),
		fileToLinktext: vi.fn((target: TFile) => target.basename),
		buildWikiLink: vi.fn(() => "[[target]]"),
		getPreview: vi.fn(async () => ({
			type: "empty" as const,
			content: "",
		})),
		sourceFile: originFile,
		getMetadata: vi.fn(() => null),
		onOpenFile: vi.fn(),
		onHop1Click: vi.fn(),
		onHop2Click: vi.fn(),
		onTagClick: vi.fn(),
	};
	const app = {} as never;
	const previewRuntime = createPreviewRuntime({
		app,
		getPreview: linkContext.getPreview,
	});
	previewRuntimes.add(previewRuntime);

	return {
		file: originFile,
		linkContext,
		applicationStore,
		app,
		previewRuntime,
		lazyLoaderCache: new Set<string>(),
		isSidebar: false,
		keyboardNavigationSurfaceRegistry: createKeyboardNavigationSurfaceRegistry(),
	} as unknown as ComponentProps<typeof TwoHopLinksPage>;
}

function renderRoot(
	displayData: DisplayData,
	settings: typeof DEFAULT_SETTINGS,
	originFile: TFile,
) {
	return render(TwoHopLinksPage, {
		props: createRootProps(displayData, settings, originFile),
	});
}

async function flushAsyncUi(): Promise<void> {
	for (let pass = 0; pass < 8; pass += 1) {
		await Promise.resolve();
		await tick();
		await vi.runOnlyPendingTimersAsync();
	}
}

function getVirtualSurface(): HTMLElement {
	const surface = document.querySelector<HTMLElement>(".twohop-virtual-surface");
	if (!surface) {
		throw new Error("Two-hop virtual surface was not rendered");
	}
	return surface;
}

async function showEntireVirtualSurface(width = 1600): Promise<HTMLElement> {
	await tick();
	const surface = getVirtualSurface();
	setElementRect(surface, { top: 0, width, height: 2000 });
	triggerResize(surface, width, 2000);
	await flushAsyncUi();
	return surface;
}

function queryCardButtons(): HTMLElement[] {
	return queryAllByRoleDeep("button", { name: / を開く$/ });
}

function queryCard(label: string): HTMLElement | null {
	return (
		queryAllByRoleDeep("button", {
			name: ARIA_LABELS.OPEN_LINK(label),
		})[0] ?? null
	);
}

function querySectionHeader(label: string): HTMLElement | null {
	return (
		queryAllByTextDeep(label).find((element) =>
			element.matches(".cosense-card-links__header-title"),
		) ?? null
	);
}

describe("TwoHopLinksPage behavior", () => {
	beforeEach(() => {
		searchResponseHarness.reset();
		vi.useFakeTimers();
		resetRecords();
		installResizeObserverMock();
		installIntersectionObserverMock();
		installAnimationFrameMock();
		setNumericProperty(window, "innerHeight", 900);
		setNumericProperty(window, "scrollY", 0);
	});

	afterEach(() => {
		searchResponseHarness.release();
		for (const runtime of previewRuntimes) runtime.dispose();
		previewRuntimes.clear();
		teardownAnimationFrameMock();
		teardownIntersectionObserverMock();
		teardownResizeObserverMock();
		vi.useRealTimers();
	});

	it("renders sections and items on initial display", async () => {
		const file = createMockTFile("notes/target.md");
		const parentFile = createMockTFile("notes/outgoing-parent.md");
		const backlinkFile = createMockTFile("notes/backlink-note.md");
		const noteFile = createMockTFile("notes/tagged-note.md");
		const displayData = {
			...createDisplayData(),
			outgoing: [createBranch(file, parentFile, [], "outgoing-parent")],
			backlinks: [createBacklink(backlinkFile, "backlink-note")],
			tagGroups: [
				{
					tag: "alpha",
					notes: [createTaggedNote(noteFile, "alpha")],
				} satisfies TagGroup,
			],
		};
		const settings = {
			...DEFAULT_SETTINGS,
			useMergedLinksSection: false,
			showTagsSection: true,
		};

		renderRoot(displayData, settings, file);

		await showEntireVirtualSurface();

		const resultsContainer = document.querySelector(
			".cosense-card-links__search-result-container",
		);
		expect(
			resultsContainer?.querySelectorAll(":scope > .cosense-card-links__section"),
		).toHaveLength(1);
		expect(queryCard("outgoing-parent")).toBeInTheDocument();
		expect(queryCard("backlink-note")).toBeInTheDocument();
		expect(queryCard("tagged-note")).toBeInTheDocument();
	});

	it("hides the two-hop section when only its parent matches the search", async () => {
		const file = createMockTFile("notes/target.md");
		const parentFile = createMockTFile("notes/needle-parent.md");
		const alphaChild = createMockTFile("notes/alpha-child.md");
		const betaChild = createMockTFile("notes/beta-child.md");
		const branch = createBranch(
			file,
			parentFile,
			[alphaChild, betaChild],
			"needle-parent",
		);
		const displayData = {
			...createDisplayData(),
			outgoing: [branch],
			twoHopBranches: [branch],
		};
		const settings = {
			...DEFAULT_SETTINGS,
			useMergedLinksSection: false,
			showTagsSection: false,
		};

		const { getByRole } = renderRoot(displayData, settings, file);
		await showEntireVirtualSurface();
		expect(queryCard("needle-parent")).toBeInTheDocument();
		expect(querySectionHeader("needle-parent")).toBeInTheDocument();
		expect(queryCard("alpha-child")).toBeInTheDocument();
		expect(queryCard("beta-child")).toBeInTheDocument();

		await fireEvent.input(getByRole("searchbox", { name: "Find cards" }), {
			target: { value: "needle-parent" },
		});
		await flushAsyncUi();

		expect(queryCard("needle-parent")).toBeInTheDocument();
		expect(querySectionHeader("needle-parent")).not.toBeInTheDocument();
		expect(queryCard("alpha-child")).not.toBeInTheDocument();
		expect(queryCard("beta-child")).not.toBeInTheDocument();
	});

	it("keeps the old searched presentation while refreshed data is filtering", async () => {
		const file = createMockTFile("notes/target.md");
		const alphaFile = createMockTFile("notes/alpha.md");
		const betaFile = createMockTFile("notes/beta.md");
		const settings = {
			...DEFAULT_SETTINGS,
			useMergedLinksSection: false,
			showTagsSection: false,
		};
		const displayDataV1 = {
			...createDisplayData(),
			backlinks: [createBacklink(alphaFile, "alpha")],
		};
		const view = renderRoot(displayDataV1, settings, file);
		await showEntireVirtualSurface();
		await fireEvent.input(view.getByRole("searchbox", { name: "Find cards" }), {
			target: { value: "alpha" },
		});
		await flushAsyncUi();
		expect(queryCard("alpha")).toBeInTheDocument();

		searchResponseHarness.hold();
		const displayDataV2 = {
			...createDisplayData(),
			backlinks: [createBacklink(betaFile, "beta")],
		};
		await view.rerender(createRootProps(displayDataV2, settings, file));
		await flushAsyncUi();

		expect(queryCard("alpha")).toBeInTheDocument();
		expect(queryCard("beta")).not.toBeInTheDocument();

		searchResponseHarness.release();
		await flushAsyncUi();
		expect(queryCard("alpha")).not.toBeInTheDocument();
	});

	it("shows a card preview after the surface becomes visible", async () => {
		const file = createMockTFile("notes/target.md");
		const parentFile = createMockTFile("notes/outgoing-parent.md");
		const displayData = {
			...createDisplayData(),
			outgoing: [createBranch(file, parentFile, [], "outgoing-parent")],
		};
		const settings = {
			...DEFAULT_SETTINGS,
			useMergedLinksSection: false,
			showTagsSection: false,
		};

		const rootProps = createRootProps(displayData, settings, file);
		vi.mocked(rootProps.linkContext.getPreview).mockResolvedValue({
			type: "image",
			content: "https://example.com/outgoing-parent.png",
		});
		const { container } = render(TwoHopLinksPage, {
			props: rootProps,
		});
		const surface = await showEntireVirtualSurface();
		expect(rootProps.linkContext.getPreview).not.toHaveBeenCalled();
		expect(surface.shadowRoot?.querySelector("img")).toBeNull();

		const root = container.querySelector<HTMLElement>(".cosense-card-links__root");
		expect(root).not.toBeNull();
		triggerIntersection(root!);
		await flushAsyncUi();

		expect(rootProps.linkContext.getPreview).toHaveBeenCalled();
		expect(surface.shadowRoot?.querySelector("img")).not.toBeNull();
	});

	it("shows the next page of cards when load more is clicked", async () => {
		const file = createMockTFile("notes/target.md");
		const notes = Array.from({ length: 20 }, (_, index) =>
			createTaggedNote(createMockTFile(`notes/tagged-${index}.md`), "alpha"),
		);
		const displayData = {
			...createDisplayData(),
			tagGroups: [{ tag: "alpha", notes } satisfies TagGroup],
		};
		const settings = {
			...DEFAULT_SETTINGS,
			defaultVisibleLinkCount: 1,
			loadMoreLinkIncrement: 10,
			useMergedLinksSection: false,
			showTagsSection: true,
		};

		render(TwoHopLinksPage, {
			props: createRootProps(displayData, settings, file),
		});
		await showEntireVirtualSurface();
		expect(queryCardButtons()).toHaveLength(1);
		expect(queryCard("tagged-0")).toBeInTheDocument();

		const loadMoreButton = queryAllByRoleDeep("button", {
			name: ARIA_LABELS.LOAD_MORE,
		})[0];
		expect(loadMoreButton).toBeTruthy();
		await fireEvent.click(loadMoreButton!);
		await flushAsyncUi();

		expect(queryCardButtons()).toHaveLength(11);
		expect(queryCard("tagged-10")).toBeInTheDocument();
	});

	it("propagates item count changes for the same sectionId (memo regression)", async () => {
		const file = createMockTFile("notes/target.md");
		const parentFile = createMockTFile("notes/outgoing-parent.md");
		const extraFile = createMockTFile("notes/outgoing-extra.md");
		const settings = {
			...DEFAULT_SETTINGS,
			useMergedLinksSection: false,
			showTagsSection: false,
		};

		const displayDataV1 = {
			...createDisplayData(),
			outgoing: [createBranch(file, parentFile, [], "outgoing-parent")],
		};
		const { rerender } = renderRoot(displayDataV1, settings, file);
		await showEntireVirtualSurface();

		expect(queryCardButtons()).toHaveLength(1);
		expect(queryCard("outgoing-parent")).toBeInTheDocument();

		const displayDataV2 = {
			...createDisplayData(),
			outgoing: [
				createBranch(file, parentFile, [], "outgoing-parent"),
				createBranch(file, extraFile, [], "outgoing-extra"),
			],
		};
		await rerender(createRootProps(displayDataV2, settings, file));
		await flushAsyncUi();

		expect(queryCardButtons()).toHaveLength(2);
		expect(queryCard("outgoing-extra")).toBeInTheDocument();
	});

	it("keeps the virtual surface mounted while sections transition through empty", async () => {
		const file = createMockTFile("notes/target.md");
		const parentFile = createMockTFile("notes/outgoing-parent.md");
		const settings = {
			...DEFAULT_SETTINGS,
			useMergedLinksSection: false,
			showTagsSection: false,
		};
		const populatedDisplayData = {
			...createDisplayData(),
			outgoing: [createBranch(file, parentFile, [], "outgoing-parent")],
		};
		const { container, rerender } = renderRoot(
			populatedDisplayData,
			settings,
			file,
		);
		await flushAsyncUi();

		const initialSurface = await showEntireVirtualSurface();
		expect(queryCard("outgoing-parent")).toBeInTheDocument();

		await rerender(createRootProps(createDisplayData(), settings, file));
		await flushAsyncUi();

		expect(container.querySelector(".twohop-page-virtual-list")).toBe(
			initialSurface,
		);
		expect(queryCard("outgoing-parent")).not.toBeInTheDocument();

		await rerender(createRootProps(populatedDisplayData, settings, file));
		await flushAsyncUi();

		expect(container.querySelector(".twohop-page-virtual-list")).toBe(
			initialSurface,
		);
		expect(queryCard("outgoing-parent")).toBeInTheDocument();
	});
});
