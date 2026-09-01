import { waitFor } from "@testing-library/dom";
import type { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "settings/model";
import { compileCardPreviewRequest } from "card-preview/pipeline/cardPreviewRequest";
import type { PreviewData } from "card-preview/types";
import type { EnqueuePreviewRender } from "card-preview/renderers/previewRenderQueue";
import type { PreviewDomCommitScope } from "card-preview/scheduling/previewDomCommitScheduler";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import {
	createCardPreviewRenderer,
	type CardPreviewLoader,
	type PreviewRenderCallbacks,
} from "../cardPreviewRenderer";
import { createCardPreviewSharedCache } from "../cardPreviewSharedCache";

const state = vi.hoisted(() => ({
	processPreviewContent: vi.fn(),
	enqueueMathRender: vi.fn(),
	highlightSearchMatchesInHtml: vi.fn(),
	getContentSnippet: vi.fn(),
	findCaseInsensitiveIndex: vi.fn(),
	htmlVisibleTextContainsCaseInsensitive: vi.fn(),
	getFileContent: vi.fn(),
	analyzePreviewContent: vi.fn(),
	syncMathJaxStylesForNode: vi.fn(),
	componentUnload: vi.fn(),
}));

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");

	class MockComponent {
		load(): void {}
		unload(): void {
			state.componentUnload();
		}
	}

	return { ...actual, Component: MockComponent };
});

vi.mock("card-preview/renderers/mathRenderQueue", () => ({
	enqueueMathRender: state.enqueueMathRender,
}));

vi.mock("card-preview/renderers/markdownPreviewRenderer", () => ({
	processPreviewContent: state.processPreviewContent,
}));

vi.mock("card-preview/text/searchHighlighter", () => ({
	highlightSearchMatchesInHtml: state.highlightSearchMatchesInHtml,
}));

vi.mock("card-preview/text/snippetExtractor", () => ({
	getContentSnippet: state.getContentSnippet,
}));

vi.mock("card-preview/text/previewTextProcessingAsync", () => ({
	getContentSnippetAsync: state.getContentSnippet,
	highlightSearchMatchesInHtmlAsync: state.highlightSearchMatchesInHtml,
}));

vi.mock("card-preview/text/searchUtils", () => ({
	findCaseInsensitiveIndex: state.findCaseInsensitiveIndex,
	htmlVisibleTextContainsCaseInsensitive:
		state.htmlVisibleTextContainsCaseInsensitive,
}));

vi.mock("card-preview/pipeline/previewContent", () => ({
	getFileContent: state.getFileContent,
	analyzePreviewContent: state.analyzePreviewContent,
}));

vi.mock("shared/ui/dom/mathJaxShadowStyles", () => ({
	syncMathJaxStylesForNode: state.syncMathJaxStylesForNode,
}));

const immediateDomCommitScope: PreviewDomCommitScope = {
	schedule: async (task) => {
		if (task.isStale()) return { type: "skipped", reason: "stale" };
		return task.commit()
			? { type: "committed" }
			: { type: "skipped", reason: "no-op" };
	},
	dispose: () => {},
};

const immediatePreviewRender: EnqueuePreviewRender = async (run) => run();

function createRequest(
	file: TFile,
	overrides: {
		searchQuery?: string;
		previewOverride?: PreviewData | null;
		previewRenderVersion?: string;
	} = {},
) {
	return compileCardPreviewRequest({
		file,
		searchQuery: overrides.searchQuery ?? "",
		previewOverride: overrides.previewOverride ?? null,
		previewRenderVersion: overrides.previewRenderVersion ?? "0:0",
		settings: DEFAULT_SETTINGS,
	});
}

function createRenderer(getPreview: CardPreviewLoader) {
	return createRendererWithCommitScopes(
		getPreview,
		immediateDomCommitScope,
		immediateDomCommitScope,
	);
}

function createRendererWithCommitScopes(
	getPreview: CardPreviewLoader,
	domCommitScope: PreviewDomCommitScope,
	imageDomCommitScope: PreviewDomCommitScope,
) {
	return createCardPreviewRenderer({
		app: { vault: {} } as App,
		getPreview,
		domCommitScope,
		imageDomCommitScope,
		enqueuePreviewRender: immediatePreviewRender,
		sharedCache: createCardPreviewSharedCache(),
	});
}

function callbacks() {
	return {
		onCommitted: vi.fn<PreviewRenderCallbacks["onCommitted"]>(),
		onError: vi.fn(),
	};
}

describe("card preview renderer contract", () => {
	beforeEach(() => {
		state.processPreviewContent.mockReset();
		state.processPreviewContent.mockImplementation(async (element, content) => {
			element.innerHTML = `<p>rendered:${content}</p>`;
		});
		state.enqueueMathRender.mockReset();
		state.enqueueMathRender.mockImplementation(async (task) => task());
		state.highlightSearchMatchesInHtml.mockReset();
		state.highlightSearchMatchesInHtml.mockImplementation(
			(content: string) => `<mark>${content}</mark>`,
		);
		state.getContentSnippet.mockReset();
		state.getContentSnippet.mockImplementation(
			(_content: string, _settings: unknown, query: string) => `snippet:${query}`,
		);
		state.findCaseInsensitiveIndex.mockReset();
		state.findCaseInsensitiveIndex.mockImplementation(
			(content: string, query: string) => content.toLowerCase().indexOf(query),
		);
		state.htmlVisibleTextContainsCaseInsensitive.mockReset();
		state.htmlVisibleTextContainsCaseInsensitive.mockImplementation(
			(content: string, query: string) =>
				content.toLowerCase().includes(query.toLowerCase()),
		);
		state.getFileContent.mockReset();
		state.getFileContent.mockResolvedValue("before alpha after");
		state.analyzePreviewContent.mockReset();
		state.analyzePreviewContent.mockImplementation((content: string) => ({
			hasDollar: false,
			hasMathExpression: false,
			contentForMathParsing: content,
			protectedSegments: [],
		}));
		state.syncMathJaxStylesForNode.mockReset();
		state.syncMathJaxStylesForNode.mockReturnValue(true);
		state.componentUnload.mockReset();
	});

	it("commits detached text and forwards the cache revision", async () => {
		const host = document.createElement("div");
		const file = createMockTFile("notes/detached-preview.md");
		const getPreview = vi.fn(async () => ({
			type: "text" as const,
			content: "detached content",
		}));
		const renderCallbacks = callbacks();
		const request = createRequest(file, { previewRenderVersion: "3:1" });

		createRenderer(getPreview)(host, request, renderCallbacks);

		await waitFor(() =>
			expect(host.textContent).toContain("rendered:detached content"),
		);
		expect(host.isConnected).toBe(false);
		expect(getPreview).toHaveBeenCalledWith(file, expect.any(AbortSignal), {
			cacheRevision: "3:1",
			renderSettings: request.settings,
		});
		expect(renderCallbacks.onCommitted).toHaveBeenCalledWith("text", "detachable");
	});

	it("does not commit a loader result after cleanup", async () => {
		const host = document.createElement("div");
		const file = createMockTFile("notes/pending-preview.md");
		let resolvePreview:
			| ((preview: { type: "text"; content: string }) => void)
			| undefined;
		let requestSignal: AbortSignal | undefined;
		const getPreview = vi.fn(
			(_file: TFile, signal?: AbortSignal) =>
				new Promise<{ type: "text"; content: string }>((resolve) => {
					requestSignal = signal;
					resolvePreview = resolve;
				}),
		);
		const cleanup = createRenderer(getPreview)(host, createRequest(file));

		await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
		cleanup();
		resolvePreview?.({ type: "text", content: "stale content" });
		await Promise.resolve();
		await Promise.resolve();

		expect(requestSignal?.aborted).toBe(true);
		expect(host.childNodes).toHaveLength(0);
	});

	it("keeps DOM preview resources until renderer cleanup", async () => {
		const host = document.createElement("div");
		const file = createMockTFile("notes/dom-preview.md");
		const getPreview = vi.fn(async () => ({
			type: "dom" as const,
			render: async (container: HTMLElement) => {
				container.textContent = "dom preview";
			},
		}));
		const renderCallbacks = callbacks();
		const cleanup = createRenderer(getPreview)(
			host,
			createRequest(file),
			renderCallbacks,
		);

		await waitFor(() => expect(host.textContent).toBe("dom preview"));
		expect(renderCallbacks.onCommitted).toHaveBeenCalledWith("dom", "host-bound");
		expect(state.componentUnload).not.toHaveBeenCalled();

		cleanup();
		expect(state.componentUnload).toHaveBeenCalledOnce();
	});

	it("cancels queued MathJax work on cleanup", async () => {
		const host = document.createElement("div");
		const file = createMockTFile("notes/math-pending.md");
		let releaseMathQueue: (() => void) | undefined;
		state.analyzePreviewContent.mockImplementation((content: string) => ({
			hasDollar: true,
			hasMathExpression: true,
			contentForMathParsing: content,
			protectedSegments: [],
		}));
		state.enqueueMathRender.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					releaseMathQueue = resolve;
				}),
		);
		const getPreview = vi.fn(async () => ({
			type: "text" as const,
			content: "$x$",
		}));
		const cleanup = createRenderer(getPreview)(host, createRequest(file));

		await waitFor(() => expect(state.enqueueMathRender).toHaveBeenCalledOnce());
		cleanup();
		releaseMathQueue?.();
		await Promise.resolve();
		await Promise.resolve();

		expect(host.childNodes).toHaveLength(0);
		expect(state.processPreviewContent).not.toHaveBeenCalled();
	});

	it("uses the shared search-context path for searchable text", async () => {
		const host = document.createElement("div");
		const file = createMockTFile("notes/search-fast-path.md");
		const getPreview = vi.fn(async () => ({
			type: "text" as const,
			content: "<p>before alpha after</p>",
		}));

		createRenderer(getPreview)(host, createRequest(file, { searchQuery: "alpha" }));

		await waitFor(() => expect(host.textContent).toContain("before alpha after"));
		expect(state.getFileContent).not.toHaveBeenCalled();
		expect(state.highlightSearchMatchesInHtml).toHaveBeenCalledOnce();
	});

	it("routes image and non-image commits through separate budget scopes", async () => {
		const domCommitScope = {
			...immediateDomCommitScope,
			schedule: vi.fn(immediateDomCommitScope.schedule),
		};
		const imageDomCommitScope = {
			...immediateDomCommitScope,
			schedule: vi.fn(immediateDomCommitScope.schedule),
		};
		const getPreview = vi.fn<CardPreviewLoader>();
		const renderer = createRendererWithCommitScopes(
			getPreview,
			domCommitScope,
			imageDomCommitScope,
		);
		const imageCallbacks = callbacks();
		const textCallbacks = callbacks();

		renderer(
			document.createElement("div"),
			createRequest(createMockTFile("images/cover.png"), {
				previewOverride: {
					type: "image",
					content: "app://local/images/cover.png",
				},
			}),
			imageCallbacks,
		);
		renderer(
			document.createElement("div"),
			createRequest(createMockTFile("notes/text.md"), {
				previewOverride: { type: "text", content: "text preview" },
			}),
			textCallbacks,
		);

		await waitFor(() => {
			expect(imageCallbacks.onCommitted).toHaveBeenCalledWith(
				"image",
				"detachable",
			);
			expect(textCallbacks.onCommitted).toHaveBeenCalledWith(
				"text",
				"detachable",
			);
		});
		expect(imageDomCommitScope.schedule).toHaveBeenCalledOnce();
		expect(domCommitScope.schedule).toHaveBeenCalledOnce();
	});

	it.each([
		{
			preview: {
				type: "image" as const,
				content: "https://example.com/preview.png",
			},
			expectedType: "image" as const,
			expectedAttachment: "detachable" as const,
		},
		{
			preview: {
				type: "dom" as const,
				render: async (container: HTMLElement) => {
					container.textContent = "override DOM";
				},
			},
			expectedType: "dom" as const,
			expectedAttachment: "host-bound" as const,
		},
		{
			preview: { type: "empty" as const, content: "" },
			expectedType: "empty" as const,
			expectedAttachment: "detachable" as const,
		},
	])(
		"renders a $expectedType override without loading preview data",
		async ({ preview, expectedType, expectedAttachment }) => {
			const host = document.createElement("div");
			const file = createMockTFile(`notes/${expectedType}-override.md`);
			const getPreview = vi.fn<CardPreviewLoader>();
			const renderCallbacks = callbacks();

			createRenderer(getPreview)(
				host,
				createRequest(file, { previewOverride: preview }),
				renderCallbacks,
			);

			await waitFor(() =>
				expect(renderCallbacks.onCommitted).toHaveBeenCalledWith(
					expectedType,
					expectedAttachment,
				),
			);
			expect(getPreview).not.toHaveBeenCalled();
		},
	);

	it("renders a reused DOM override for each distinct request", async () => {
		const host = document.createElement("div");
		const file = createMockTFile("notes/dom-override.md");
		const getPreview = vi.fn<CardPreviewLoader>();
		let domText = "first DOM";
		const domRender = vi.fn(async (container: HTMLElement) => {
			container.textContent = domText;
		});
		const renderer = createRenderer(getPreview);
		const firstCleanup = renderer(
			host,
			createRequest(file, {
				previewOverride: { type: "dom", render: domRender },
			}),
		);

		await waitFor(() => expect(host.textContent).toBe("first DOM"));
		firstCleanup();
		domText = "second DOM";
		renderer(
			host,
			createRequest(file, {
				previewOverride: { type: "dom", render: domRender },
			}),
		);

		await waitFor(() => expect(host.textContent).toBe("second DOM"));
		expect(domRender).toHaveBeenCalledTimes(2);
		expect(getPreview).not.toHaveBeenCalled();
	});
});
