import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "types/settings";

const {
	getActiveInlineContainerSpy,
	getLeafIdSpy,
	handleMountErrorSpy,
	handleUnmountErrorSpy,
	mountSpy,
	unmountSpy,
} = vi.hoisted(() => ({
	getActiveInlineContainerSpy: vi.fn(),
	getLeafIdSpy: vi.fn(),
	handleMountErrorSpy: vi.fn(),
	handleUnmountErrorSpy: vi.fn(),
	mountSpy: vi.fn(),
	unmountSpy: vi.fn(),
}));

vi.mock("ui/utils/domUtils", () => ({
	getActiveInlineContainer: getActiveInlineContainerSpy,
}));

vi.mock("infrastructure/utils/workspaceUtils", () => ({
	getLeafId: getLeafIdSpy,
}));

vi.mock("utils/errorHandler", () => ({
	handleMountError: handleMountErrorSpy,
	handleUnmountError: handleUnmountErrorSpy,
}));

vi.mock("features/two-hop/ui/TwoHopLinksPage.svelte", () => ({
	default: {},
}));

vi.mock("svelte", () => ({
	mount: mountSpy,
	unmount: unmountSpy,
}));

vi.mock("obsidian", () => {
	class TFile {
		path = "";
		name = "";
		basename = "";
		extension = "";
		stat = { ctime: 0, mtime: 0, size: 0 };
		vault = {};
		parent = null;
	}

	class MarkdownView {
		containerEl = document.createElement("div");
		addChild = vi.fn();
		removeChild = vi.fn();
	}

	class WorkspaceLeaf {
		view: unknown;
		id: string;

		constructor(view: unknown, id = "leaf-1") {
			this.view = view;
			this.id = id;
		}
	}

	class MarkdownRenderChild {
		onunload: () => void = () => {};

		constructor(public readonly containerEl: HTMLElement) {}

		unload(): void {
			this.onunload();
		}
	}

	class App {}

	return {
		App,
		MarkdownRenderChild,
		MarkdownView,
		TFile,
		WorkspaceLeaf,
	};
});

import { TFile, MarkdownView, WorkspaceLeaf } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import {
	ComponentController,
	RECENT_APPLICATION_STORE_LIMIT,
} from "../ComponentController";

function createController() {
	const view = new MarkdownView({} as any);
	const leaf = new WorkspaceLeaf() as WorkspaceLeaf & {
		view: unknown;
		id: string;
	};
	leaf.view = view;
	leaf.id = "leaf-1";
	const workspace = {
		getLeavesOfType: vi.fn(() => [leaf]),
		iterateAllLeaves: vi.fn(),
	};
	const app = { workspace } as any;
	const resolveTwoHopLinks = vi.fn(async (file: TFile) => ({
		originFile: file,
		branches: [],
		backlinks: [],
		taggedNotes: [],
	}));
	const buildDisplayData = vi.fn(() => ({
		outgoing: [],
		backlinks: [],
		mergedItems: [],
		twoHopBranches: [],
		tagGroups: [],
		newLinks: [],
	}));
	const indexingService = {
		onDataUpdate: vi.fn(() => vi.fn()),
	};
	const linkContextFactory = vi.fn(() => ({}));
	const plugin = {
		app,
		createDisplayDataBuilder: vi.fn(() => buildDisplayData),
		getLinkContextFactory: vi.fn(() => linkContextFactory),
		getTwoHopLinkResult: resolveTwoHopLinks,
	};

	const controller = new ComponentController(
		app,
		plugin as any,
		() => DEFAULT_SETTINGS,
		indexingService as any,
		vi.fn(),
	);

	return {
		controller,
		plugin,
		resolveTwoHopLinks,
		view,
	};
}

function getStoresFromMountCalls(): unknown[] {
	const stores: unknown[] = [];
	for (const call of mountSpy.mock.calls) {
		const options = call[1] as
			| { props?: { applicationStore?: unknown } }
			| undefined;
		if (options?.props?.applicationStore) {
			stores.push(options.props.applicationStore);
		}
	}
	return stores;
}

function getLazyCachesFromMountCalls(): Set<unknown>[] {
	const caches: Set<unknown>[] = [];
	for (const call of mountSpy.mock.calls) {
		const options = call[1] as
			| { props?: { lazyLoaderCache?: Set<unknown> } }
			| undefined;
		if (options?.props?.lazyLoaderCache) {
			caches.push(options.props.lazyLoaderCache);
		}
	}
	return caches;
}

function getUiStatesFromMountCalls(): Array<{ searchInputValue: string }> {
	const states: Array<{ searchInputValue: string }> = [];
	for (const call of mountSpy.mock.calls) {
		const options = call[1] as
			| { props?: { uiState?: { searchInputValue: string } } }
			| undefined;
		if (options?.props?.uiState) {
			states.push(options.props.uiState);
		}
	}
	return states;
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("ComponentController mountComponentsForView", () => {
	let sourceContainer: HTMLElement;

	beforeEach(() => {
		getActiveInlineContainerSpy.mockReset();
		getLeafIdSpy.mockReset();
		handleMountErrorSpy.mockReset();
		handleUnmountErrorSpy.mockReset();
		mountSpy.mockReset();
		unmountSpy.mockReset();

		sourceContainer = document.createElement("div");
		document.body.append(sourceContainer);
		getActiveInlineContainerSpy.mockReturnValue({
			surface: "source",
			container: sourceContainer,
		});
		getLeafIdSpy.mockReturnValue("leaf-1");
		mountSpy.mockImplementation(() => ({
			componentId: Symbol("mounted-component"),
		}));
	});

	it("skips the same file and target when skipIfMounted is enabled", () => {
		const { controller, view } = createController();
		const file = createMockTFile("notes/alpha.md");

		controller.mountComponentsForView(view, file);
		controller.mountComponentsForView(view, file, {
			skipIfMounted: true,
		});

		expect(mountSpy).toHaveBeenCalledTimes(1);
		expect(unmountSpy).not.toHaveBeenCalled();
	});

	it("remounts the same file when the active surface changes", () => {
		const { controller, view } = createController();
		const file = createMockTFile("notes/alpha.md");
		const previewContainer = document.createElement("div");
		document.body.append(previewContainer);

		controller.mountComponentsForView(view, file);
		getActiveInlineContainerSpy.mockReturnValue({
			surface: "preview",
			container: previewContainer,
		});
		controller.mountComponentsForView(view, file, {
			skipIfMounted: true,
		});

		expect(mountSpy).toHaveBeenCalledTimes(2);
		expect(unmountSpy).toHaveBeenCalledTimes(1);
		expect(getStoresFromMountCalls()[1]).toBe(getStoresFromMountCalls()[0]);
		expect(view.removeChild).toHaveBeenCalledTimes(1);
	});

	it("mounts a new surface before unloading the previous surface", () => {
		const { controller, view } = createController();
		const file = createMockTFile("notes/alpha.md");
		const previewContainer = document.createElement("div");
		document.body.append(previewContainer);

		controller.mountComponentsForView(view, file);
		getActiveInlineContainerSpy.mockReturnValue({
			surface: "preview",
			container: previewContainer,
		});
		mountSpy.mockImplementationOnce(() => {
			expect(unmountSpy).not.toHaveBeenCalled();
			return { componentId: Symbol("next-component") };
		});

		controller.mountComponentsForView(view, file, {
			skipIfMounted: true,
		});

		expect(unmountSpy).toHaveBeenCalledTimes(1);
	});

	it("keeps the previous root while the active container is unavailable", () => {
		const { controller, view } = createController();
		const file = createMockTFile("notes/alpha.md");

		controller.mountComponentsForView(view, file);
		getActiveInlineContainerSpy.mockReturnValue(null);
		controller.mountComponentsForView(view, file, {
			skipIfMounted: true,
		});

		expect(mountSpy).toHaveBeenCalledTimes(1);
		expect(unmountSpy).not.toHaveBeenCalled();
	});

	it("keeps the previous root when mounting a new container fails", () => {
		const { controller, view } = createController();
		const file = createMockTFile("notes/alpha.md");
		const previewContainer = document.createElement("div");
		document.body.append(previewContainer);

		controller.mountComponentsForView(view, file);
		getActiveInlineContainerSpy.mockReturnValue({
			surface: "preview",
			container: previewContainer,
		});
		mountSpy.mockImplementationOnce(() => {
			throw new Error("mount failed");
		});

		expect(() =>
			controller.mountComponentsForView(view, file, {
				skipIfMounted: true,
			}),
		).toThrow("mount failed");
		expect(unmountSpy).not.toHaveBeenCalled();

		getActiveInlineContainerSpy.mockReturnValue({
			surface: "source",
			container: sourceContainer,
		});
		controller.mountComponentsForView(view, file, {
			skipIfMounted: true,
		});

		expect(mountSpy).toHaveBeenCalledTimes(2);
		expect(handleMountErrorSpy).toHaveBeenCalledTimes(1);
	});

	it("remounts same-file views by default", () => {
		const { controller, view } = createController();
		const file = createMockTFile("notes/alpha.md");

		controller.mountComponentsForView(view, file);
		controller.mountComponentsForView(view, file);

		expect(mountSpy).toHaveBeenCalledTimes(2);
		expect(unmountSpy).toHaveBeenCalledTimes(1);
	});

	it("clears the lazy cache when switching to a different file", () => {
		const { controller, view } = createController();
		const firstFile = createMockTFile("notes/alpha.md");
		const secondFile = createMockTFile("notes/beta.md");

		controller.mountComponentsForView(view, firstFile);
		const firstCaches = getLazyCachesFromMountCalls();
		firstCaches[0].add("cached-preview");

		controller.mountComponentsForView(view, secondFile);
		const secondCaches = getLazyCachesFromMountCalls();

		expect(mountSpy).toHaveBeenCalledTimes(2);
		expect(unmountSpy).toHaveBeenCalledTimes(1);
		expect(secondCaches[0].size).toBe(0);
	});

	it("preserves the same search input across inline surface changes", () => {
		const { controller, view } = createController();
		const file = createMockTFile("notes/alpha.md");
		const previewContainer = document.createElement("div");
		document.body.append(previewContainer);

		controller.mountComponentsForView(view, file);
		getUiStatesFromMountCalls()[0].searchInputValue = "source query";

		getActiveInlineContainerSpy.mockReturnValue({
			surface: "preview",
			container: previewContainer,
		});
		controller.mountComponentsForView(view, file, { skipIfMounted: true });
		const previewState = getUiStatesFromMountCalls()[1];
		expect(previewState.searchInputValue).toBe("source query");
		expect(previewState).toBe(getUiStatesFromMountCalls()[0]);

		getActiveInlineContainerSpy.mockReturnValue({
			surface: "source",
			container: sourceContainer,
		});
		controller.mountComponentsForView(view, file, { skipIfMounted: true });

		expect(getUiStatesFromMountCalls()[2]).toBe(previewState);
		expect(getUiStatesFromMountCalls()[2].searchInputValue).toBe("source query");
	});

	it("clears inline search state when the file changes", () => {
		const { controller, view } = createController();
		const firstFile = createMockTFile("notes/alpha.md");
		const secondFile = createMockTFile("notes/beta.md");

		controller.mountComponentsForView(view, firstFile);
		getUiStatesFromMountCalls()[0].searchInputValue = "alpha query";
		controller.mountComponentsForView(view, secondFile);

		expect(getUiStatesFromMountCalls()[1].searchInputValue).toBe("");
	});

	it("reuses a recent store and builder when revisiting a file in the same leaf", async () => {
		const { controller, plugin, resolveTwoHopLinks, view } = createController();
		const alpha = createMockTFile("notes/alpha.md");
		const beta = createMockTFile("notes/beta.md");

		controller.mountComponentsForView(view, alpha);
		await flushMicrotasks();
		const alphaStores = getStoresFromMountCalls();
		const alphaStore = alphaStores[0] as { destroy: () => void };
		const alphaDestroySpy = vi.spyOn(alphaStore, "destroy");

		controller.mountComponentsForView(view, beta);
		await flushMicrotasks();
		controller.mountComponentsForView(view, alpha);
		await flushMicrotasks();

		expect(plugin.createDisplayDataBuilder).toHaveBeenCalledTimes(1);
		expect(resolveTwoHopLinks).toHaveBeenCalledTimes(2);

		const allStores = getStoresFromMountCalls();
		const finalAlphaStore = allStores[allStores.length - 1] as {
			destroy: () => void;
		};
		expect(finalAlphaStore).toBe(alphaStore);
		expect(alphaDestroySpy).not.toHaveBeenCalled();
	});

	it("evicts the least recently used idle store when the cache limit is exceeded", async () => {
		const { controller, view } = createController();
		const files = Array.from(
			{ length: RECENT_APPLICATION_STORE_LIMIT + 2 },
			(_, index) => createMockTFile(`notes/file-${index + 1}.md`),
		);

		controller.mountComponentsForView(view, files[0]);
		await flushMicrotasks();
		const firstMountStores = getStoresFromMountCalls();
		const firstStore = firstMountStores[0] as { destroy: () => void };
		const firstDestroySpy = vi.spyOn(firstStore, "destroy");

		for (const file of files.slice(1)) {
			controller.mountComponentsForView(view, file);
			await flushMicrotasks();
		}

		expect(firstDestroySpy).toHaveBeenCalledTimes(1);
	});
});
