import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/svelte";
import { TagNotesView } from "search/tag-notes/TagNotesView";
import { DEFAULT_SETTINGS } from "settings/model";

const { triggerUpdateMock, toViewItemsMock } = vi.hoisted(() => ({
	triggerUpdateMock: vi.fn(),
	toViewItemsMock: vi.fn((items: unknown[]) => items),
}));

function attachDomHelpers<T extends HTMLElement>(el: T): T {
	const extended = el as T & {
		empty: () => void;
		createDiv: (options?: { cls?: string; text?: string }) => HTMLDivElement;
		createSpan: (options?: { cls?: string; text?: string }) => HTMLSpanElement;
		createEl: (
			tag: string,
			options?: {
				cls?: string;
				text?: string;
			},
		) => HTMLElement;
	};

	extended.empty = () => {
		el.replaceChildren();
	};

	extended.createDiv = (options?: { cls?: string; text?: string }) => {
		const child = attachDomHelpers(document.createElement("div"));
		if (options?.cls) {
			child.className = options.cls;
		}
		if (options?.text) {
			child.textContent = options.text;
		}
		el.appendChild(child);
		return child;
	};

	extended.createSpan = (options?: { cls?: string; text?: string }) => {
		const child = attachDomHelpers(document.createElement("span"));
		if (options?.cls) {
			child.className = options.cls;
		}
		if (options?.text) {
			child.textContent = options.text;
		}
		el.appendChild(child);
		return child;
	};

	extended.createEl = (tag: string, options?: { cls?: string; text?: string }) => {
		const child = attachDomHelpers(document.createElement(tag));
		if (options?.cls) {
			child.className = options.cls;
		}
		if (options?.text) {
			child.textContent = options.text;
		}
		el.appendChild(child);
		return child;
	};

	return el;
}

vi.mock("obsidian", () => {
	class TFile {
		path = "";
		name = "";
		basename = "";
		extension = "md";
		parent: unknown = null;
		stat = { ctime: 0, mtime: 0, size: 0 };
	}

	class ItemView {
		app: any;
		leaf: any;
		contentEl: HTMLDivElement;
		navigation = false;

		constructor(leaf: any) {
			this.leaf = leaf;
			this.app = leaf?.app ?? {
				vault: {
					getAbstractFileByPath: vi.fn(() => null),
				},
				workspace: {
					getActiveFile: vi.fn(() => null),
				},
			};
			this.contentEl = attachDomHelpers(document.createElement("div"));
			document.body.appendChild(this.contentEl);
		}

		async onOpen(): Promise<void> {}
		async onClose(): Promise<void> {}
		async setState(): Promise<void> {}
		getState(): Record<string, unknown> {
			return {};
		}
	}

	return {
		ItemView,
		TFile,
		Scope: vi.fn(function () {
			return { register: vi.fn(), unregister: vi.fn() };
		}),
		setIcon: vi.fn(),
	};
});

vi.mock("obsidian-integration/views/editorLikeFrame", () => {
	return {
		buildEditorLikeFrame: (
			containerEl: HTMLElement,
			options: {
				title: string;
				extraWrapperClasses?: string[];
			},
		) => {
			const wrapperEl = attachDomHelpers(document.createElement("div"));
			const scrollerEl = attachDomHelpers(document.createElement("div"));
			const sizerEl = attachDomHelpers(document.createElement("div"));
			const titleEl = attachDomHelpers(document.createElement("div"));
			const infoEl = attachDomHelpers(document.createElement("div"));
			const contentContainerEl = attachDomHelpers(document.createElement("div"));
			const contentEl = attachDomHelpers(document.createElement("div"));

			wrapperEl.className = [
				"markdown-source-view",
				"cm-s-obsidian",
				"mod-cm6",
				"is-readable-line-width",
				...(options.extraWrapperClasses ?? []),
			].join(" ");
			titleEl.textContent = options.title;
			contentEl.setAttribute("role", "textbox");
			contentEl.setAttribute("aria-multiline", "true");
			contentEl.appendChild(document.createElement("br"));

			contentContainerEl.appendChild(contentEl);
			sizerEl.append(titleEl, infoEl, contentContainerEl);
			scrollerEl.appendChild(sizerEl);
			wrapperEl.appendChild(scrollerEl);
			containerEl.appendChild(wrapperEl);

			return {
				wrapperEl,
				scrollerEl,
				sizerEl,
				titleEl,
				infoEl,
				contentEl,
			};
		},
	};
});

vi.mock("obsidian-integration/views/viewFactories", () => {
	return {
		createDefaultCardCollectionState: vi.fn(() => ({
			destroy: vi.fn(),
			triggerUpdate: triggerUpdateMock,
		})),
		createLinkContextForView: vi.fn(() => ({
			resolveFile: vi.fn(() => null),
			sourceFile: { path: "" },
		})),
	};
});

vi.mock("cards/list/ui/TagNotesListHost.svelte", async () => {
	const component = await import("./TagNotesListHostAutofocusProbe.svelte");
	return { default: component.default };
});

vi.mock("cards/list/ui/ViewItemCard.svelte", () => ({
	default: {},
}));

vi.mock("cards/CardItem", () => ({
	getCardItemKey: vi.fn(() => "view-item-key"),
	toCardItems: toViewItemsMock,
	fromCardItem: vi.fn((item: unknown) => item),
}));

vi.mock("indexing/tag-index/tagIndexer", () => ({
	normalizeTag: vi.fn((tag: string) => tag.replace(/^#/u, "")),
}));

afterEach(() => {
	document.body.innerHTML = "";
	vi.clearAllMocks();
	triggerUpdateMock.mockClear();
	toViewItemsMock.mockClear();
});

function createLeaf(): any {
	return {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
			},
			workspace: {
				getActiveFile: vi.fn(() => null),
			},
		},
	};
}

function createPlugin(): any {
	return {
		settings: {
			...DEFAULT_SETTINGS,
			cardWidthPx: 140,
		},
		indexingService: {
			peekNotesWithTag: vi.fn(() => []),
			getNotesWithTag: vi.fn(async () => []),
			onDataUpdate: vi.fn(() => vi.fn()),
		},
	};
}

function createViewServices(): any {
	return {
		previewRuntime: {},
		keyboardNavigationSurfaceRegistry: {
			register: vi.fn(() => vi.fn()),
		},
	};
}

function createTaggedNote(
	path: string,
	mtime: number,
): {
	path: string;
	file: { path: string; stat: { mtime: number } };
} {
	return {
		path,
		file: {
			path,
			stat: {
				mtime,
			},
		},
	};
}

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
}

describe("TagNotesView", () => {
	it("loads and renders tag notes through setState", async () => {
		const deferredNotes = createDeferred<ReturnType<typeof createTaggedNote>[]>();
		const getNotesWithTag = vi.fn(() => deferredNotes.promise);
		const view = new TagNotesView(
			createLeaf(),
			{
				...createPlugin(),
				indexingService: {
					...createPlugin().indexingService,
					getNotesWithTag,
				},
			},
			createViewServices(),
		);
		const result = { history: false };

		await view.setState(
			{
				tag: "#alpha",
				sourcePath: "source.md",
			},
			result,
		);

		expect(result.history).toBe(true);
		expect(view.getDisplayText()).toBe("#alpha");
		expect(getNotesWithTag).toHaveBeenCalledWith("alpha", "source.md");
		expect(
			screen.getByText("Waiting for the tag index to finish building."),
		).toBeInTheDocument();

		deferredNotes.resolve([createTaggedNote("notes/alpha.md", 2)]);

		await waitFor(() => {
			expect(
				screen.getByText("Showing 1 notes tagged with #alpha."),
			).toBeInTheDocument();
			expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
				"data-item-count",
				"1",
			);
		});
	});

	it("round-trips list UI navigation state without retaining payload references", async () => {
		const listUiState = {
			searchInputValue: "project",
			scrollState: {
				localScrollTop: 640,
				visibleCount: 90,
			},
		};
		const view = new TagNotesView(
			createLeaf(),
			{
				...createPlugin(),
				indexingService: {
					...createPlugin().indexingService,
					getNotesWithTag: vi.fn(async () => [
						createTaggedNote("notes/alpha.md", 1),
					]),
				},
			},
			createViewServices(),
		);

		await view.setState(
			{ tag: "alpha", sourcePath: "source.md", listUiState },
			{ history: false },
		);
		await waitFor(() => {
			expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
				"data-search-input",
				"project",
			);
		});
		expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
			"data-local-scroll-top",
			"640",
		);
		expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
			"data-visible-count",
			"90",
		);

		listUiState.searchInputValue = "mutated input";
		listUiState.scrollState.localScrollTop = 1;
		const firstSnapshot = view.getState() as {
			listUiState: typeof listUiState;
		};
		expect(firstSnapshot.listUiState).toEqual({
			searchInputValue: "project",
			scrollState: { localScrollTop: 640, visibleCount: 90 },
		});

		firstSnapshot.listUiState.scrollState.localScrollTop = 2;
		expect(view.getState()).toMatchObject({
			listUiState: {
				searchInputValue: "project",
				scrollState: { localScrollTop: 640, visibleCount: 90 },
			},
		});
	});

	it("refreshes loaded notes from an index update after onOpen", async () => {
		let onDataUpdate: ((context: { affectedTags?: string[] }) => void) | undefined;
		const initialNote = createTaggedNote("notes/alpha-a.md", 1);
		const nextNotes = [
			createTaggedNote("notes/alpha-a.md", 2),
			createTaggedNote("notes/alpha-b.md", 3),
		];
		const peekNotesWithTag = vi.fn(() => nextNotes);
		const view = new TagNotesView(
			createLeaf(),
			{
				...createPlugin(),
				indexingService: {
					peekNotesWithTag,
					getNotesWithTag: vi.fn(async () => [initialNote]),
					onDataUpdate: vi.fn((callback) => {
						onDataUpdate = callback;
						return vi.fn();
					}),
				},
			},
			createViewServices(),
		);

		await view.setState({ tag: "alpha" }, { history: false });
		await Promise.resolve();
		await Promise.resolve();

		await view.onOpen();
		expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
			"data-item-count",
			"1",
		);

		onDataUpdate?.({
			affectedTags: ["alpha"],
		});

		expect(peekNotesWithTag).toHaveBeenCalledWith("alpha", "");
		expect(
			screen.getByText("Showing 2 notes tagged with #alpha."),
		).toBeInTheDocument();
		await waitFor(() => {
			expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
				"data-item-count",
				"2",
			);
		});
	});

	it("autofocuses the first list rendered after an interleaved load", async () => {
		const deferredNotes = createDeferred<ReturnType<typeof createTaggedNote>[]>();
		const view = new TagNotesView(
			createLeaf(),
			{
				...createPlugin(),
				indexingService: {
					...createPlugin().indexingService,
					getNotesWithTag: vi.fn(() => deferredNotes.promise),
				},
			},
			createViewServices(),
		);

		await view.setState({ tag: "alpha" }, { history: false });

		expect(screen.queryByTestId("tag-notes-list-host")).toBeNull();
		expect(
			screen.getByText("Waiting for the tag index to finish building."),
		).toBeInTheDocument();

		deferredNotes.resolve([createTaggedNote("notes/alpha.md", 1)]);
		await waitFor(() =>
			expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
				"data-autofocus",
				"true",
			),
		);

		view.refreshFromSettings();

		expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
			"data-autofocus",
			"false",
		);
	});
});
