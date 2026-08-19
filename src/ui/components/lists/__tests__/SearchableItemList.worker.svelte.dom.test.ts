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
import type { SearchWorkerMatchedItem } from "features/search/searchWorkerTypes";
import { filterSearchWorkerDatasetWithMatchDetails } from "features/search/searchWorkerFilter";

type WorkerMessage =
	| {
			type: "filter-result";
			requestId: number;
			datasetVersion: number;
			matchedItems: SearchWorkerMatchedItem[];
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

const yieldHarness = vi.hoisted(() => {
	const calls: unknown[] = [];
	let nextYield: (() => Promise<void>) | null = null;

	return {
		calls,
		setNextYield(fn: () => Promise<void>) {
			nextYield = fn;
		},
		reset() {
			calls.length = 0;
			nextYield = null;
		},
		async yieldToMainThreadIdleAware(options: unknown) {
			calls.push(options);
			const fn = nextYield;
			nextYield = null;
			if (fn) {
				await fn();
			}
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

const mockBookmarksState = vi.hoisted(() => {
	const filePaths = new Set<string>();
	const orderedFilePaths: string[] = [];

	return {
		filePaths,
		orderedFilePaths,
		isBookmarked: vi.fn(
			(path: string | null | undefined) => !!path && filePaths.has(path),
		),
		reset() {
			filePaths.clear();
			orderedFilePaths.length = 0;
			this.isBookmarked.mockClear();
		},
	};
});

vi.mock("ui/components/items/ViewItemCard.svelte", async () => {
	const component = await import("./SearchableItemListItemStub.svelte");
	return { default: component.default };
});

vi.mock("core/indexing/timeSlicing", () => ({
	yieldToMainThreadIdleAware: yieldHarness.yieldToMainThreadIdleAware,
}));

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
						contentByPath.set(entry.path, entry.content);
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
					const matchedItems = filterSearchWorkerDatasetWithMatchDetails(
						snapshot,
						request.query,
						request.matchScope,
						contentByPath,
					);
					const response: WorkerMessage = {
						type: "filter-result",
						requestId: request.requestId,
						datasetVersion: request.datasetVersion,
						matchedItems,
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
	useBookmarks: () => mockBookmarksState,
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

/**
 * A comfortably large input. Large enough that the filter loop is guaranteed
 * to hit several yield checkpoints before finishing, for any reasonable
 * chunking policy.
 */
const LARGE_INPUT_ITEM_COUNT = 1000;

function createManyTaggedNoteItems(basenamePrefix: string, count: number): ViewItem[] {
	return Array.from({ length: count }, (_unused, index) =>
		createTaggedNoteItem(
			createMockTFile(
				`notes/${basenamePrefix}-${String(index).padStart(3, "0")}.md`,
			),
		),
	);
}

/**
 * Mocks `performance.now` to always report freshly elapsed time so the filter
 * loop's time-budget gate opens on every checkpoint. The step is deliberately
 * generous so the test does not depend on the exact budget in milliseconds.
 * Returns a function that restores the original implementation.
 */
function mockElapsedPerformanceNow(): () => void {
	let now = 0;
	const spy = vi.spyOn(performance, "now").mockImplementation(() => {
		now += 1000;
		return now;
	});
	return () => spy.mockRestore();
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

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

describe("SearchableItemList worker integration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		workerHarness.reset();
		yieldHarness.reset();
		fileContentIndexHarness.reset();
		mockBookmarksState.reset();
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

	it("yields before completing a large filtered search, publishing partial results", async () => {
		vi.useRealTimers();
		const yieldGate = createDeferred<void>();
		yieldHarness.setNextYield(() => yieldGate.promise);
		const restorePerformanceNow = mockElapsedPerformanceNow();
		const items = createManyTaggedNoteItems("target", LARGE_INPUT_ITEM_COUNT);

		try {
			render(SearchableItemList, { props: createTestProps({ items }) });
			await flushAsyncUi();

			const input = screen.getByRole("searchbox");
			await fireEvent.input(input, { target: { value: "target" } });
			await flushAsyncUi();

			await waitFor(() => expect(yieldHarness.calls).toHaveLength(1));
			const partialCount = Number(
				screen.getByTestId("filtered-count").textContent,
			);
			expect(partialCount).toBeGreaterThan(0);
			expect(partialCount).toBeLessThan(items.length);

			yieldGate.resolve();

			await waitFor(() =>
				expect(screen.getByTestId("filtered-count")).toHaveTextContent(
					String(items.length),
				),
			);
		} finally {
			restorePerformanceNow();
		}
	}, 10000);

	it("discards an older chunked filter run after the query changes", async () => {
		vi.useRealTimers();
		const yieldGate = createDeferred<void>();
		yieldHarness.setNextYield(() => yieldGate.promise);
		const restorePerformanceNow = mockElapsedPerformanceNow();
		const alphaItems = createManyTaggedNoteItems("alpha", LARGE_INPUT_ITEM_COUNT);
		const betaItem = createTaggedNoteItem(createMockTFile("notes/beta.md"));

		try {
			const props = createTestProps({ items: [...alphaItems, betaItem] });
			props.config = {
				...props.config,
				getSearchText: (item) =>
					item.type === "taggedNote" ? item.data.file.basename : "",
			};
			render(SearchableItemList, {
				props,
			});
			await flushAsyncUi();

			const input = screen.getByRole("searchbox");
			await fireEvent.input(input, { target: { value: "alpha" } });
			await flushAsyncUi();

			await waitFor(() => expect(yieldHarness.calls).toHaveLength(1));
			const partialAlphaCount = Number(
				screen.getByTestId("filtered-count").textContent,
			);
			expect(partialAlphaCount).toBeGreaterThan(0);
			expect(partialAlphaCount).toBeLessThan(alphaItems.length);

			await fireEvent.input(input, { target: { value: "beta" } });
			await flushAsyncUi();

			await waitFor(() =>
				expect(screen.getByTestId("filtered-count")).toHaveTextContent(/^1$/),
			);
			expect(getAllSearchableItems()[0]).toHaveTextContent("beta");

			yieldGate.resolve();
			await flushAsyncUi();

			expect(screen.getByTestId("filtered-count")).toHaveTextContent(/^1$/);
			expect(getAllSearchableItems()[0]).toHaveTextContent("beta");
		} finally {
			restorePerformanceNow();
		}
	}, 10000);

	it("keeps previous results mounted while a new search is in flight", async () => {
		workerHarness.setAutoReleaseFilters(false);

		render(SearchableItemList, { props: createTestProps() });
		await flushAsyncUi();

		const input = screen.getByRole("searchbox");
		expect(getAllSearchableItems()).toHaveLength(2);

		// First search: the worker response is held back, so matchesByKey
		// stays null and the unfiltered list must remain visible instead of
		// unmounting LinkList.
		await fireEvent.input(input, { target: { value: "alpha" } });
		await vi.advanceTimersByTimeAsync(150);
		await flushAsyncUi();
		expect(getAllSearchableItems()).toHaveLength(2);

		workerHarness.releasePendingFilter(0);
		await flushAsyncUi();
		await waitFor(() => expect(getAllSearchableItems()).toHaveLength(1));
		expect(getAllSearchableItems()[0]).toHaveTextContent("alpha");

		// Query change: matchesByKey is reset to null until the new result
		// arrives, so the previous result set must stay mounted.
		await fireEvent.input(input, { target: { value: "beta" } });
		await vi.advanceTimersByTimeAsync(150);
		await flushAsyncUi();
		expect(getAllSearchableItems()).toHaveLength(1);
		expect(getAllSearchableItems()[0]).toHaveTextContent("alpha");

		workerHarness.releasePendingFilter(0);
		await flushAsyncUi();
		await waitFor(() => expect(getAllSearchableItems()).toHaveLength(1));
		expect(getAllSearchableItems()[0]).toHaveTextContent("beta");
	});

	it("applies bookmark pinning to the final filtered result", async () => {
		mockBookmarksState.filePaths.add("notes/beta.md");
		mockBookmarksState.orderedFilePaths.push("notes/beta.md");
		const items = [
			createTaggedNoteItem(createMockTFile("notes/alpha.md")),
			createTaggedNoteItem(createMockTFile("notes/beta.md")),
		];
		const props = createTestProps({ items });
		props.config = {
			...props.config,
			pinBookmarkedToTop: true,
		};

		render(SearchableItemList, { props });
		await flushAsyncUi();

		const input = screen.getByRole("searchbox");
		await fireEvent.input(input, { target: { value: "a" } });
		await flushAsyncUi();

		await waitFor(() =>
			expect(screen.getByTestId("filtered-count")).toHaveTextContent("2"),
		);

		const renderedItems = getAllSearchableItems();
		expect(renderedItems[0]).toHaveTextContent("beta");
		expect(renderedItems[1]).toHaveTextContent("alpha");
	});
});
