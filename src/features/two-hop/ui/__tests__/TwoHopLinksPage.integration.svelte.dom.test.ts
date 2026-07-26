import { render, screen } from "@testing-library/svelte";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type {
	TagGroup,
	TaggedNote,
	TwoHopIndexedLink,
	TwoHopLinkBranch,
	TwoHopLinkResult,
} from "types/domain";
import type { DisplayData } from "features/two-hop/application/displayDataBuilder";
import TwoHopLinksPage from "../TwoHopLinksPage.svelte";
import {
	getTwoHopSurfacePageStubProps,
	resetTwoHopSurfacePageStubProps,
} from "./twoHopSurfacePageStubCapture";

vi.mock("features/search/searchWorkerClient", async () => {
	const { filterSearchWorkerDataset } =
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
						contentByPath.set(entry.path, entry.content.toLowerCase());
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
						matchedKeys: filterSearchWorkerDataset(
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

vi.mock("ui/components/items/ViewItemCard.svelte", async () => {
	const component = await import("./TwoHopLinksPageItemStub.svelte");
	return { default: component.default };
});

vi.mock("features/two-hop/ui/TwoHopSurface.svelte", async () => {
	const component = await import("./TwoHopSurfacePageStub.svelte");
	return { default: component.default };
});

vi.mock("ui/components/common/LinkSectionHeader.svelte", () => ({
	default: () => null,
}));

vi.mock("ui/hooks/useBookmarks.svelte", () => ({
	useBookmarks: () => ({
		filePaths: new Set<string>(),
		orderedFilePaths: [],
		isBookmarked: () => false,
	}),
}));

vi.mock("features/search/useFileContentIndex.svelte", () => ({
	useFileContentIndex: () => ({
		hasMatch: () => false,
		isLoading: () => false,
		getFirstMatchPosition: () => undefined,
		forEachEntry: () => {},
		getSerializableEntries: () => [],
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

function createBacklink(
	sourceFile: TFile,
	rawText: string = sourceFile.basename,
): TwoHopIndexedLink {
	return {
		sourceFile,
		rawText,
		path: sourceFile.path,
		isUnresolved: false,
		backlinkCount: 0,
	} as TwoHopIndexedLink;
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

function createApplicationStore(
	displayData: DisplayData,
	settings: typeof DEFAULT_SETTINGS,
	originFile: TFile,
) {
	const expandedLimits = new Map<string, number>();
	const linkResult: TwoHopLinkResult = {
		originFile,
		branches: [...displayData.outgoing, ...displayData.twoHopBranches],
		backlinks: displayData.backlinks,
		taggedNotes: displayData.tagGroups.flatMap((section) => section.notes),
	};

	return {
		loading: false,
		loadingPhase: "complete" as const,
		data: linkResult,
		displayState: {
			displayData,
			hasDisplayableItems: true,
		},
		initialVisibleCount: 10,
		loadMoreIncrement: 10,
		settings,
		sortOption: settings.lastUsedSortOption,
		setSortOption: vi.fn(),
		getDefaultSectionVisibleLimit: vi.fn(() => 10),
		getSectionExpandedLimit: vi.fn((sectionId: string) =>
			expandedLimits.get(sectionId),
		),
		setSectionExpandedLimit: vi.fn((sectionId: string, limit: number) => {
			expandedLimits.set(sectionId, limit);
		}),
		getSortedTwoHopItems: vi.fn((items: TwoHopIndexedLink[]) => items),
		getSortedTagGroupItems: vi.fn((items: TaggedNote[]) => items),
		triggerUpdate: vi.fn(),
		updateVersion: 0,
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
	const applicationStore = createApplicationStore(displayData, settings, originFile);
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

	return {
		file: originFile,
		linkContext,
		applicationStore,
		app: {} as never,
		lazyLoaderCache: new Set<string>(),
		isSidebar: false,
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
	await Promise.resolve();
	await vi.runOnlyPendingTimersAsync();
	await Promise.resolve();
}

describe("TwoHopLinksPage descriptor plumbing", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetTwoHopSurfacePageStubProps();
	});

	afterEach(() => {
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

		const { container } = renderRoot(displayData, settings, file);

		await flushAsyncUi();

		expect(container.querySelectorAll(".view-plan-virtual-list")).toHaveLength(1);
		expect(screen.getByText("outgoing-parent")).toBeInTheDocument();
		expect(screen.getByText("backlink-note")).toBeInTheDocument();
		expect(screen.getByText("tagged-note")).toBeInTheDocument();
	});

	it("passes one explicit preview dependency set to the virtual surface", async () => {
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
		render(TwoHopLinksPage, {
			props: rootProps,
		});
		await flushAsyncUi();

		const surface = screen.getByTestId("two-hop-surface-stub");
		const capturedProps = getTwoHopSurfacePageStubProps();
		expect(surface.dataset.hasPreviewDependencies).toBe("true");
		expect(surface.dataset.hasPreviewLoader).toBe("true");
		expect(surface.dataset.settingsGetterMatches).toBe("true");
		expect(surface.dataset.hasSearchPositionResolver).toBe("true");
		expect(surface.dataset.previewActive).toBe("true");
		expect(capturedProps?.applicationStore).toBe(rootProps.applicationStore);
		expect(capturedProps?.previewDependencies?.getPreview).toBe(
			rootProps.linkContext.getPreview,
		);
		expect(capturedProps?.previewDependencies?.app).toBe(rootProps.app);
		expect(capturedProps?.previewDependencies?.getSettings()).toBe(
			rootProps.applicationStore.settings,
		);

		const nextSettings = {
			...settings,
			previewDomCommitsPerSecond: settings.previewDomCommitsPerSecond + 1,
		};
		rootProps.applicationStore.settings = nextSettings;
		expect(capturedProps?.previewDependencies?.getSettings()).toBe(nextSettings);
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
		const { container, rerender } = renderRoot(displayDataV1, settings, file);
		await flushAsyncUi();

		const items = () =>
			container.querySelectorAll('[data-testid="root-link-item"]');
		expect(items()).toHaveLength(1);
		expect(screen.getByText("outgoing-parent")).toBeInTheDocument();

		const displayDataV2 = {
			...createDisplayData(),
			outgoing: [
				createBranch(file, parentFile, [], "outgoing-parent"),
				createBranch(file, extraFile, [], "outgoing-extra"),
			],
		};
		await rerender(createRootProps(displayDataV2, settings, file));
		await flushAsyncUi();

		expect(items()).toHaveLength(2);
		expect(screen.getByText("outgoing-extra")).toBeInTheDocument();
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

		const initialSurface = container.querySelector(".view-plan-virtual-list");
		expect(initialSurface).not.toBeNull();
		expect(screen.getByText("outgoing-parent")).toBeInTheDocument();

		await rerender(createRootProps(createDisplayData(), settings, file));
		await flushAsyncUi();

		expect(container.querySelector(".view-plan-virtual-list")).toBe(initialSurface);
		expect(screen.queryByText("outgoing-parent")).not.toBeInTheDocument();

		await rerender(createRootProps(populatedDisplayData, settings, file));
		await flushAsyncUi();

		expect(container.querySelector(".view-plan-virtual-list")).toBe(initialSurface);
		expect(screen.getByText("outgoing-parent")).toBeInTheDocument();
	});
});
