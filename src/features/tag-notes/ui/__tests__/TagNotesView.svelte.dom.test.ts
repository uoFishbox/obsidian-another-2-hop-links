import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/svelte";
import { TagNotesView } from "features/tag-notes/ui/TagNotesView";
import { DEFAULT_SETTINGS } from "features/settings/model";

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
		setIcon: vi.fn(),
	};
});

vi.mock("ui/shared/views/editorLikeFrame", () => {
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

vi.mock("ui/shared/views/viewFactories", () => {
	return {
		createDefaultApplicationStore: vi.fn(() => ({
			destroy: vi.fn(),
			triggerUpdate: triggerUpdateMock,
		})),
		createLinkContextForView: vi.fn(() => ({
			resolveFile: vi.fn(() => null),
			sourceFile: { path: "" },
		})),
	};
});

vi.mock("ui/components/lists/TagNotesListHost.svelte", async () => {
	const component = await import("./TagNotesListHostAutofocusProbe.svelte");
	return { default: component.default };
});

vi.mock("ui/components/items/ViewItemCard.svelte", () => ({
	default: {},
}));

vi.mock("application/presenters", () => ({
	getViewItemKey: vi.fn(() => "view-item-key"),
	toViewItems: toViewItemsMock,
	fromViewItem: vi.fn((item: unknown) => item),
}));

vi.mock("core/indexing/tag-index/tagIndexer", () => ({
	normalizeTag: vi.fn((tag: string) => tag.replace(/^#/u, "")),
}));

afterEach(() => {
	document.body.innerHTML = "";
	vi.clearAllMocks();
	triggerUpdateMock.mockClear();
	toViewItemsMock.mockClear();
});

class TagNotesViewHarness extends TagNotesView {
	public setTag(tag: string, sourcePath = ""): void {
		(this as unknown as { tag: string; sourcePath: string }).tag = tag;
		(this as unknown as { tag: string; sourcePath: string }).sourcePath =
			sourcePath;
	}

	public renderForTest(): void {
		this.render();
	}

	public refreshForTest(context?: {
		indexVersion: number;
		affectsAll?: boolean;
		affectedPaths?: string[];
		affectedTags?: string[];
	}): void {
		this.refreshItemsForContext(context);
	}

	public shouldRefreshForContextForTest(context?: {
		indexVersion: number;
		affectsAll?: boolean;
		affectedPaths?: string[];
		affectedTags?: string[];
	}): boolean {
		return this.shouldRefreshForContext(context);
	}

	public getCurrentItemsForTest(): Array<{ path: string }> {
		return this.getCurrentItems();
	}
}

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
		const view = new TagNotesView(createLeaf(), {
			...createPlugin(),
			indexingService: {
				...createPlugin().indexingService,
				getNotesWithTag,
			},
		});
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

	it("refreshes loaded notes from an index update after onOpen", async () => {
		let onDataUpdate:
			| ((context: { indexVersion: number; affectedTags?: string[] }) => void)
			| undefined;
		const initialNote = createTaggedNote("notes/alpha-a.md", 1);
		const nextNotes = [
			createTaggedNote("notes/alpha-a.md", 2),
			createTaggedNote("notes/alpha-b.md", 3),
		];
		const peekNotesWithTag = vi.fn(() => nextNotes);
		const view = new TagNotesView(createLeaf(), {
			...createPlugin(),
			indexingService: {
				peekNotesWithTag,
				getNotesWithTag: vi.fn(async () => [initialNote]),
				onDataUpdate: vi.fn((callback) => {
					onDataUpdate = callback;
					return vi.fn();
				}),
			},
		});

		await view.setState({ tag: "alpha" }, { history: false });
		await Promise.resolve();
		await Promise.resolve();

		await view.onOpen();
		expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
			"data-item-count",
			"1",
		);

		onDataUpdate?.({
			indexVersion: 2,
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

	it("autofocuses on initial list render even when loading was interleaved", () => {
		const view = new TagNotesViewHarness(createLeaf(), createPlugin());

		view.setTag("alpha");
		(
			view as unknown as {
				isLoadingNotes: boolean;
				hasLoadedNotes: boolean;
				notes: Array<{ path: string }>;
			}
		).isLoadingNotes = true;
		(
			view as unknown as {
				isLoadingNotes: boolean;
				hasLoadedNotes: boolean;
				notes: Array<{ path: string }>;
			}
		).hasLoadedNotes = false;
		(
			view as unknown as {
				isLoadingNotes: boolean;
				hasLoadedNotes: boolean;
				notes: Array<{ path: string }>;
			}
		).notes = [];

		view.renderForTest();

		expect(screen.queryByTestId("tag-notes-list-host")).toBeNull();
		expect(
			screen.getByText("Waiting for the tag index to finish building."),
		).toBeInTheDocument();

		(
			view as unknown as {
				isLoadingNotes: boolean;
				hasLoadedNotes: boolean;
				notes: Array<{ path: string }>;
			}
		).isLoadingNotes = false;
		(
			view as unknown as {
				isLoadingNotes: boolean;
				hasLoadedNotes: boolean;
				notes: Array<{ path: string }>;
			}
		).hasLoadedNotes = true;
		(
			view as unknown as {
				isLoadingNotes: boolean;
				hasLoadedNotes: boolean;
				notes: Array<{ path: string }>;
			}
		).notes = [{ path: "notes/alpha.md" }];

		view.renderForTest();

		expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
			"data-autofocus",
			"true",
		);

		view.refreshFromSettings();

		expect(screen.getByTestId("tag-notes-list-host")).toHaveAttribute(
			"data-autofocus",
			"false",
		);
	});

	it("does not request re-render for updates unrelated to affectedTags", () => {
		const view = new TagNotesViewHarness(createLeaf(), createPlugin());

		view.setTag("alpha", "source.md");
		(view as unknown as { hasLoadedNotes: boolean }).hasLoadedNotes = true;
		(view as unknown as { notes: Array<{ path: string }> }).notes = [
			createTaggedNote("notes/alpha.md", 1),
		];

		expect(
			view.shouldRefreshForContextForTest({
				indexVersion: 1,
				affectedTags: ["beta"],
				affectedPaths: ["notes/other.md"],
			}),
		).toBe(false);

		expect(
			view.shouldRefreshForContextForTest({
				indexVersion: 1,
				affectedTags: ["alpha"],
			}),
		).toBe(true);
	});

	it("updates mounted list via diff without calling render on index update", async () => {
		const peekNotesWithTag = vi.fn(() => [
			createTaggedNote("notes/alpha-a.md", 2),
			createTaggedNote("notes/alpha-b.md", 3),
		]);
		const view = new TagNotesViewHarness(createLeaf(), {
			...createPlugin(),
			indexingService: {
				peekNotesWithTag,
			},
		});

		view.setTag("alpha");
		(view as unknown as { hasLoadedNotes: boolean }).hasLoadedNotes = true;
		(view as unknown as { notes: ReturnType<typeof createTaggedNote>[] }).notes = [
			createTaggedNote("notes/alpha-a.md", 1),
		];

		const renderSpy = vi.spyOn(view as unknown as { render: () => void }, "render");

		view.renderForTest();
		renderSpy.mockClear();

		const host = screen.getByTestId("tag-notes-list-host");
		expect(host).toHaveAttribute("data-item-count", "1");

		view.refreshForTest({
			indexVersion: 2,
			affectedTags: ["alpha"],
		});

		expect(peekNotesWithTag).toHaveBeenCalledWith("alpha", "");
		expect(renderSpy).not.toHaveBeenCalled();
		expect(
			screen.getByText("Showing 2 notes tagged with #alpha."),
		).toBeInTheDocument();
		expect(screen.getByTestId("tag-notes-list-host")).toBe(host);
		expect(view.getCurrentItemsForTest()).toHaveLength(2);
	});

	it("skips update when diff result is same reference array as previous", () => {
		const alpha = createTaggedNote("notes/alpha-a.md", 1);
		const peekNotesWithTag = vi.fn(() => [alpha]);
		const view = new TagNotesViewHarness(createLeaf(), {
			...createPlugin(),
			indexingService: {
				peekNotesWithTag,
			},
		});

		view.setTag("alpha");
		(view as unknown as { hasLoadedNotes: boolean }).hasLoadedNotes = true;
		(view as unknown as { notes: ReturnType<typeof createTaggedNote>[] }).notes = [
			alpha,
		];

		view.renderForTest();

		toViewItemsMock.mockClear();
		triggerUpdateMock.mockClear();

		view.refreshForTest({
			indexVersion: 2,
			affectedTags: ["alpha"],
		});

		expect(peekNotesWithTag).toHaveBeenCalledWith("alpha", "");
		expect(toViewItemsMock).not.toHaveBeenCalled();
		expect(triggerUpdateMock).not.toHaveBeenCalled();
		expect(view.getCurrentItemsForTest()[0]).toBe(alpha);
	});
});
