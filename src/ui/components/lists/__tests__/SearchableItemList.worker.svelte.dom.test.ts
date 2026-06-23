import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchableItemList from "../SearchableItemList.svelte";
import SearchableItemListItemStub from "./SearchableItemListItemStub.svelte";
import type { ViewItem } from "application/presenters";
import type { ListConfig } from "../types";
import type { LinkContext } from "ui/context/linkContext";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { ISortService } from "types/services";

type WorkerMessage =
	| {
			type: "filter-result";
			requestId: number;
			datasetVersion: number;
			matchedKeys: string[];
	  }
	| {
			type: "error";
			message: string;
			requestId?: number;
			datasetVersion?: number;
	  };

const workerHarness = vi.hoisted(() => {
	let handler: ((message: WorkerMessage) => void) | null = null;
	let pendingFilterResponses: WorkerMessage[] = [];
	let autoReleaseFilters = true;

	const calls = {
		syncItems: [] as unknown[],
		upsertFileContents: [] as unknown[],
		removeFileContents: [] as unknown[],
		filter: [] as unknown[],
		terminate: [] as unknown[],
	};

	return {
		getCalls() {
			return { ...calls };
		},
		getPendingFilterResponses() {
			return [...pendingFilterResponses];
		},
		shouldAutoReleaseFilters() {
			return autoReleaseFilters;
		},
		attach(nextHandler: (message: WorkerMessage) => void) {
			handler = nextHandler;
		},
		emit(message: WorkerMessage) {
			handler?.(message);
		},
		queueFilterResponse(response: WorkerMessage) {
			pendingFilterResponses.push(response);
		},
		setAutoReleaseFilters(next: boolean) {
			autoReleaseFilters = next;
		},
		releasePendingFilter(index: number = 0) {
			if (index < pendingFilterResponses.length) {
				const response = pendingFilterResponses.splice(index, 1)[0];
				handler?.(response);
			}
		},
		releaseAllPendingFilters() {
			const responses = [...pendingFilterResponses];
			pendingFilterResponses = [];
			for (const response of responses) {
				handler?.(response);
			}
		},
		reset() {
			handler = null;
			pendingFilterResponses = [];
			autoReleaseFilters = true;
			calls.syncItems = [];
			calls.upsertFileContents = [];
			calls.removeFileContents = [];
			calls.filter = [];
			calls.terminate = [];
		},
	};
});

const fileContentIndexHarness = vi.hoisted(() => {
	const state = {
		isLoading: false,
		entries: [] as Array<{
			path: string;
			content: string;
			mtime: number;
		}>,
	};

	return {
		state,
		setLoading(next: boolean) {
			state.isLoading = next;
		},
		setEntries(next: Array<{ path: string; content: string; mtime: number }>) {
			state.entries = next;
		},
		reset() {
			state.isLoading = false;
			state.entries = [];
		},
	};
});

vi.mock("features/search/searchWorkerClient", async () => {
	const { filterSearchWorkerDataset } =
		await import("features/search/searchWorkerFilter");

	return {
		createSearchWorkerClient: (onMessage: (message: unknown) => void) => {
			workerHarness.attach(onMessage);
			let snapshot = {
				datasetVersion: 0,
				items: [] as Array<{
					key: string;
					searchText: string;
					targetFilePath: string | null;
				}>,
				fileContents: [],
			};
			let contentByPath = new Map<string, string>();

			return {
				syncItems: (nextSnapshot: typeof snapshot) => {
					workerHarness.getCalls().syncItems.push(nextSnapshot);
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
					workerHarness.getCalls().upsertFileContents.push(update);
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
					workerHarness.getCalls().removeFileContents.push(update);
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
					workerHarness.getCalls().filter.push(request);
					const matchedKeys = filterSearchWorkerDataset(
						snapshot,
						request.query,
						request.matchScope,
						contentByPath,
					);
					const response: WorkerMessage = {
						type: "filter-result",
						requestId: request.requestId,
						datasetVersion: request.datasetVersion,
						matchedKeys,
					};
					if (workerHarness.shouldAutoReleaseFilters()) {
						workerHarness.emit(response);
					} else {
						workerHarness.queueFilterResponse(response);
					}
				},
				terminate: () => {
					workerHarness.getCalls().terminate.push(undefined);
				},
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
		isLoading: vi.fn(() => fileContentIndexHarness.state.isLoading),
		getFirstMatchPosition: vi.fn(() => undefined),
		forEachEntry: vi.fn((visitor) => {
			for (const entry of fileContentIndexHarness.state.entries) {
				visitor(entry.path, {
					content: entry.content,
					mtime: entry.mtime,
				});
			}
		}),
		getSerializableEntries: vi.fn(() => fileContentIndexHarness.state.entries),
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

vi.mock("ui/components/common/VirtualGridLinkList.svelte", async () => {
	const component = await import("./SearchableItemListLinkListStub.svelte");
	return { default: component.default };
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
		itemComponent: SearchableItemListItemStub,
		getItemProps: (item) => ({
			label: item.type === "taggedNote" ? item.data.file.basename : "unknown",
		}),
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

function createTestProps(overrides?: { items?: ViewItem[]; sourceFile?: TFile }) {
	const sourceFile = overrides?.sourceFile ?? createMockTFile("notes/source.md");
	const items = overrides?.items ?? [
		createTaggedNoteItem(createMockTFile("notes/alpha-note.md")),
		createTaggedNoteItem(createMockTFile("notes/beta-note.md")),
	];
	const expandedLimits = new Map<string, number>();
	const applicationStore = {
		sortOption: "alphabetical",
		initialVisibleCount: 10,
		loadMoreIncrement: 10,
		settings: {
			enableContentSearch: false,
		},
		setSortOption: vi.fn(),
		setContentSearchEnabled: vi.fn((enabled: boolean) => {
			applicationStore.settings.enableContentSearch = enabled;
		}),
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

	return {
		items,
		config: createConfig(),
		linkContext: createLinkContext(sourceFile),
		applicationStore,
		sortService,
		app: {} as never,
		autofocus: false,
	};
}

describe("SearchableItemList worker integration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		workerHarness.reset();
		fileContentIndexHarness.reset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("toggles full-text search on and off, changing visible results", async () => {
		fileContentIndexHarness.setEntries([
			{
				path: "notes/beta-note.md",
				content: "body includes hidden token",
				mtime: 1,
			},
		]);

		render(SearchableItemList, { props: createTestProps() });

		await flushAsyncUi();

		const input = screen.getByRole("searchbox");
		await fireEvent.input(input, { target: { value: "hidden token" } });
		await vi.advanceTimersByTimeAsync(150);
		await flushAsyncUi();

		await waitFor(() =>
			expect(queryAllByTestIdIncludingShadow("searchable-item")).toHaveLength(0),
		);

		const toggle = screen.getByRole("button", {
			name: "Enable full-text search",
		});
		await fireEvent.click(toggle);
		await tick();

		await waitFor(() => expect(getAllSearchableItems()).toHaveLength(1));
		expect(getByTextIncludingShadow("beta-note")).toBeInTheDocument();

		const activeToggle = screen.getByRole("button", {
			name: "Disable full-text search",
		});
		await fireEvent.click(activeToggle);
		await tick();

		await waitFor(() =>
			expect(queryAllByTestIdIncludingShadow("searchable-item")).toHaveLength(0),
		);
	});
});
