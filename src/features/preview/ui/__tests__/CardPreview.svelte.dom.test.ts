import { render, waitFor } from "@testing-library/svelte";
import type { TFile } from "obsidian";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type PluginSettings } from "features/settings/model";
import { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import CardPreview from "../CardPreview.svelte";
import { clearCardPreviewSharedCaches } from "../cardPreviewSharedCache";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { resetPreviewDomCommitSchedulerForTests } from "features/preview/scheduling/previewDomCommitScheduler";

const state = vi.hoisted(() => ({
	appContext: {
		app: { vault: {} },
		applicationStore: {
			settings: {} as PluginSettings,
			updateVersion: 0,
			getPreviewRenderVersion: vi.fn(() => "0:0"),
		} as unknown as ApplicationStore,
	},
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
	disableCardDomPreview: false,
	disableRenderedPreviewCache: false,
}));

vi.mock("ui/context/linkContext", () => ({
	useAppContext: () => state.appContext,
}));

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");

	class MockComponent {
		load(): void {}
		unload(): void {
			state.componentUnload();
		}
	}

	return {
		...actual,
		Component: MockComponent,
	};
});

vi.mock("appConstants", async (importOriginal) => {
	const actual = await importOriginal<typeof import("appConstants")>();

	return {
		...actual,
		get DEBUG_DISABLE_CARD_DOM_PREVIEW() {
			return state.disableCardDomPreview;
		},
		get DEBUG_DISABLE_RENDERED_PREVIEW_CACHE() {
			return state.disableRenderedPreviewCache;
		},
	};
});

vi.mock("features/preview/renderers/mathRenderQueue", () => ({
	enqueueMathRender: state.enqueueMathRender,
}));

vi.mock("features/preview/renderers/markdownPreviewRenderer", () => ({
	processPreviewContent: state.processPreviewContent,
}));

vi.mock("features/preview/text-processing/searchHighlighter", () => ({
	highlightSearchMatchesInHtml: state.highlightSearchMatchesInHtml,
}));

vi.mock("features/preview/text-processing/snippetExtractor", () => ({
	getContentSnippet: state.getContentSnippet,
}));

vi.mock("features/preview/text-processing/previewTextProcessingAsync", () => ({
	getContentSnippetAsync: state.getContentSnippet,
	highlightSearchMatchesInHtmlAsync: state.highlightSearchMatchesInHtml,
}));

vi.mock("features/preview/text-processing/searchUtils", () => ({
	findCaseInsensitiveIndex: state.findCaseInsensitiveIndex,
	htmlVisibleTextContainsCaseInsensitive:
		state.htmlVisibleTextContainsCaseInsensitive,
}));

vi.mock("features/preview/core/previewContent", () => ({
	getFileContent: state.getFileContent,
	analyzePreviewContent: state.analyzePreviewContent,
}));

vi.mock("ui/shared/dom/mathJaxShadowStyles", () => ({
	syncMathJaxStylesForNode: state.syncMathJaxStylesForNode,
}));

function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
	return {
		...DEFAULT_SETTINGS,
		...overrides,
	};
}

function createReactiveApplicationStore(settings = createSettings()): ApplicationStore {
	return new ApplicationStore(settings, {} as never, vi.fn() as never, vi.fn());
}

describe("CardPreview", () => {
	beforeEach(() => {
		(HTMLElement.prototype as any).createEl = function (
			tagName: string,
			options?: { attr?: Record<string, string> },
		) {
			const element = document.createElement(tagName);
			for (const [name, value] of Object.entries(options?.attr ?? {})) {
				element.setAttribute(name, value);
			}
			this.appendChild(element);
			return element;
		};
		(HTMLElement.prototype as any).createDiv = function (options?: {
			cls?: string;
		}) {
			const element = document.createElement("div");
			if (options?.cls) {
				element.className = options.cls;
			}
			this.appendChild(element);
			return element;
		};

		clearCardPreviewSharedCaches();
		state.appContext.app = { vault: {} };
		state.appContext.applicationStore = {
			settings: createSettings(),
			updateVersion: 0,
			getPreviewRenderVersion: vi.fn(() => "0:0"),
		} as unknown as ApplicationStore;
		state.disableCardDomPreview = false;
		state.disableRenderedPreviewCache = false;

		state.processPreviewContent.mockReset();
		state.processPreviewContent.mockImplementation(async (element, content) => {
			element.innerHTML = `<p>rendered:${content}</p>`;
		});

		state.enqueueMathRender.mockReset();
		state.enqueueMathRender.mockImplementation(async (task) => {
			await task();
		});

		state.highlightSearchMatchesInHtml.mockReset();
		state.highlightSearchMatchesInHtml.mockImplementation(
			(content: string) => `<mark>${content}</mark>`,
		);

		state.getContentSnippet.mockReset();
		state.getContentSnippet.mockImplementation(
			(
				_rawContent: string,
				_settings: PluginSettings,
				query: string,
				options: { firstMatchIndex: number },
			) => `snippet:${query}:${options.firstMatchIndex}`,
		);

		state.findCaseInsensitiveIndex.mockReset();
		state.findCaseInsensitiveIndex.mockImplementation(
			(content: string, query: string) => content.toLowerCase().indexOf(query),
		);

		state.htmlVisibleTextContainsCaseInsensitive.mockReset();
		state.htmlVisibleTextContainsCaseInsensitive.mockImplementation(
			(content: string, query: string) => content.toLowerCase().includes(query),
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

	afterEach(() => {
		resetPreviewDomCommitSchedulerForTests();
	});

	it("commits a preview while its card is temporarily detached", async () => {
		const detachedTarget = document.createElement("div");
		const file = createMockTFile("notes/detached-preview.md");
		const getPreview = vi.fn(async () => ({
			type: "text" as const,
			content: "detached content",
		}));

		const rendered = render(CardPreview, {
			target: detachedTarget,
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			expect(rendered.container.isConnected).toBe(false);
			expect(
				rendered.container.querySelector(".cosense-card-links__box-preview")
					?.textContent,
			).toContain("rendered:detached content");
		});
	});

	it("displays rendered text preview", async () => {
		const file = createMockTFile("notes/render-cache.md");
		const getPreview = vi.fn(async () => ({
			type: "text" as const,
			content: "preview text",
		}));

		render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			expect(
				document.querySelector(".cosense-card-links__box-preview")?.textContent,
			).toContain("rendered:preview text");
		});
		expect(getPreview).toHaveBeenCalledTimes(1);
	});

	it("keeps committed static DOM resident when rendering is not admitted", async () => {
		const file = createMockTFile("notes/inactive-preview.md");
		const getPreview = vi.fn(async () => ({
			type: "image" as const,
			content: "app://inactive-preview.png",
		}));
		const rendered = render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			const preview = rendered.container.querySelector(
				".cosense-card-links__box-preview",
			);
			expect(preview?.querySelector("img")).toBeTruthy();
			expect(preview).toHaveClass("cosense-card-links__box-preview--image");
		});

		await rendered.rerender({ file: undefined, getPreview, searchQuery: "" });

		await waitFor(() => {
			const preview = rendered.container.querySelector(
				".cosense-card-links__box-preview",
			);
			expect(preview).toBeTruthy();
			expect(preview?.querySelector("img")).toBeTruthy();
			expect(preview).toHaveClass("is-stale");
			expect(preview).not.toHaveClass("hidden");
			expect(preview).toHaveClass("cosense-card-links__box-preview--image");
		});
	});

	it("retains and reuses resident DOM when the same binding leaves and re-enters the preview range", async () => {
		const file = createMockTFile("notes/resident-preview.md");
		const snapshot = {
			identity: "resident-identity",
			file,
			searchQuery: "",
			previewRefreshToken: 0,
			previewOverride: null,
		};
		const getPreview = vi.fn(async () => ({
			type: "text" as const,
			content: "resident content",
		}));
		const rendered = render(CardPreview, {
			props: {
				bindingIdentity: snapshot.identity,
				renderSnapshot: snapshot,
				getPreview,
			},
		});

		const preview = rendered.container.querySelector(
			".cosense-card-links__box-preview",
		);
		await waitFor(() => {
			expect(preview?.textContent).toContain("rendered:resident content");
		});
		const committedContent = preview?.firstChild;

		await rendered.rerender({
			bindingIdentity: snapshot.identity,
			renderSnapshot: undefined,
			getPreview,
		});
		expect(preview?.firstChild).toBe(committedContent);
		expect(preview).not.toHaveClass("is-stale");
		expect(preview).not.toHaveClass("hidden");

		await rendered.rerender({
			bindingIdentity: snapshot.identity,
			renderSnapshot: snapshot,
			getPreview,
		});
		await tick();
		expect(preview?.firstChild).toBe(committedContent);
		expect(getPreview).toHaveBeenCalledTimes(1);
	});

	it("reactivates a different file in the same component without stale DOM", async () => {
		const fileA = createMockTFile("notes/preview-a.md");
		const fileB = createMockTFile("notes/preview-b.md");
		const getPreview = vi.fn(async (file: TFile) => ({
			type: "text" as const,
			content: file.path,
		}));
		const rendered = render(CardPreview, {
			props: { file: fileA, getPreview, searchQuery: "" },
		});
		const preview = rendered.container.querySelector(
			".cosense-card-links__box-preview",
		);

		await waitFor(() => {
			expect(preview?.textContent).toContain("rendered:notes/preview-a.md");
		});
		await rendered.rerender({
			file: undefined,
			getPreview,
			searchQuery: "",
		});
		await waitFor(() => expect(preview).toHaveClass("is-stale"));
		expect(preview?.textContent).toContain("rendered:notes/preview-a.md");
		await rendered.rerender({ file: fileB, getPreview, searchQuery: "" });

		await waitFor(() => {
			expect(preview?.textContent).toContain("rendered:notes/preview-b.md");
			expect(preview?.textContent).not.toContain("notes/preview-a.md");
		});
	});

	it("aborts an in-flight request when the preview becomes inactive", async () => {
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
		const rendered = render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
		await rendered.rerender({ file: undefined, getPreview, searchQuery: "" });

		expect(requestSignal?.aborted).toBe(true);
		resolvePreview?.({ type: "text", content: "stale content" });
		await tick();
		await tick();
		expect(
			rendered.container.querySelector(".cosense-card-links__box-preview"),
		).toBeEmptyDOMElement();
	});

	it("unloads a DOM preview and resets its content type when inactive", async () => {
		const file = createMockTFile("notes/dom-inactive.md");
		const getPreview = vi.fn(async () => ({
			type: "dom" as const,
			render: async (container: HTMLElement) => {
				container.textContent = "active dom";
			},
		}));
		const rendered = render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			const preview = rendered.container.querySelector(
				".cosense-card-links__box-preview",
			);
			expect(preview?.textContent).toBe("active dom");
			expect(preview).toHaveClass("cosense-card-links__box-preview--dom");
		});
		await rendered.rerender({ file: undefined, getPreview, searchQuery: "" });

		await waitFor(() => {
			const preview = rendered.container.querySelector(
				".cosense-card-links__box-preview",
			);
			expect(state.componentUnload).toHaveBeenCalledTimes(1);
			expect(preview).toBeEmptyDOMElement();
			expect(preview).toHaveClass("is-stale");
			expect(preview).toHaveClass("cosense-card-links__box-preview--dom");
		});
	});

	it("removes a MathJax skeleton when inactive and renders cleanly after reactivation", async () => {
		const mathFile = createMockTFile("notes/math-pending.md");
		const textFile = createMockTFile("notes/plain-after-math.md");
		let releaseMathQueue: (() => void) | undefined;
		state.analyzePreviewContent.mockImplementation((content: string) => ({
			hasDollar: content.includes("$"),
			hasMathExpression: content.includes("$"),
			contentForMathParsing: content,
			protectedSegments: [],
		}));
		state.enqueueMathRender.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					releaseMathQueue = resolve;
				}),
		);
		const getPreview = vi.fn(async (file: TFile) => ({
			type: "text" as const,
			content: file === mathFile ? "$x$" : "plain content",
		}));
		const rendered = render(CardPreview, {
			props: { file: mathFile, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			expect(rendered.container.querySelector(".skeleton-loader")).toBeTruthy();
		});
		await rendered.rerender({
			file: undefined,
			getPreview,
			searchQuery: "",
		});

		await waitFor(() => {
			expect(rendered.container.querySelector(".skeleton-loader")).toBeNull();
			expect(
				rendered.container.querySelector(".cosense-card-links__box-preview"),
			).toHaveClass("is-stale");
		});
		releaseMathQueue?.();
		state.enqueueMathRender.mockImplementation(async (task) => {
			await task();
		});
		await rendered.rerender({ file: textFile, getPreview, searchQuery: "" });

		await waitFor(() => {
			expect(rendered.container.querySelector(".skeleton-loader")).toBeNull();
			expect(
				rendered.container.querySelector(".cosense-card-links__box-preview")
					?.textContent,
			).toContain("rendered:plain content");
		});
	});

	it("reuses cached preview on remount for the same file", async () => {
		const file = createMockTFile("notes/render-cache.md");
		const getPreview = vi.fn(async () => ({
			type: "text" as const,
			content: "preview text",
		}));

		const firstRender = render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			expect(
				document.querySelector(".cosense-card-links__box-preview")?.textContent,
			).toContain("rendered:preview text");
		});

		firstRender.unmount();

		render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			expect(
				document.querySelector(".cosense-card-links__box-preview")?.textContent,
			).toContain("rendered:preview text");
		});
		expect(state.processPreviewContent).toHaveBeenCalledTimes(1);
	});

	it("passes searchable text preview content through the shared cache path", async () => {
		const file = createMockTFile("notes/search-fast-path.md");
		const getPreview = vi.fn(async () => ({
			type: "text" as const,
			content: "<p>before alpha after</p>",
		}));

		render(CardPreview, {
			props: { file, getPreview, searchQuery: "alpha" },
		});

		await waitFor(() => {
			expect(
				document.querySelector(".cosense-card-links__box-preview")?.textContent,
			).toContain("before alpha after");
		});

		expect(state.getFileContent).not.toHaveBeenCalled();
		expect(state.highlightSearchMatchesInHtml).toHaveBeenCalledTimes(1);
	});

	it.each([
		{
			type: "image" as const,
			content: "app://local-image.png",
			expectedText: "",
		},
		{
			type: "dom" as const,
			render: async (container: HTMLElement) => {
				container.textContent = "dom preview";
			},
			expectedText: "dom preview",
		},
		{
			type: "empty" as const,
			content: "",
			expectedText: "",
		},
	])("handles $type previews", async (preview) => {
		const file = createMockTFile(`notes/${preview.type}-preview.md`);
		const getPreview = vi.fn(async () => preview);

		const rendered = render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			const previewEl = rendered.container.querySelector(
				".cosense-card-links__box-preview",
			);
			expect(previewEl?.classList).toContain(
				`cosense-card-links__box-preview--${preview.type}`,
			);
			expect(previewEl?.textContent).toBe(preview.expectedText);
		});
	});

	it("rerenders when an image preview override changes without a refresh token bump", async () => {
		const file = createMockTFile("notes/image-override.md");
		const getPreview = vi.fn(async () => ({
			type: "empty" as const,
			content: "",
		}));

		const rendered = render(CardPreview, {
			props: {
				file,
				getPreview,
				searchQuery: "",
				previewRefreshToken: 0,
				previewOverride: {
					type: "image" as const,
					content: "app://first-image.png",
				},
			},
		});

		await waitFor(() => {
			const image = rendered.container.querySelector("img");
			expect(image?.getAttribute("src")).toContain("first-image.png");
		});

		await rendered.rerender({
			file,
			getPreview,
			searchQuery: "",
			previewRefreshToken: 0,
			previewOverride: {
				type: "image" as const,
				content: "app://second-image.png",
			},
		});

		await waitFor(() => {
			const image = rendered.container.querySelector("img");
			expect(image?.getAttribute("src")).toContain("second-image.png");
		});
		expect(getPreview).not.toHaveBeenCalled();
	});

	it("rerenders dom preview overrides even when the renderer function is reused", async () => {
		const file = createMockTFile("notes/dom-override.md");
		const getPreview = vi.fn(async () => ({
			type: "empty" as const,
			content: "",
		}));
		let domText = "first dom";
		const domRender = vi.fn(async (container: HTMLElement) => {
			container.textContent = domText;
		});

		const rendered = render(CardPreview, {
			props: {
				file,
				getPreview,
				searchQuery: "",
				previewRefreshToken: 0,
				previewOverride: {
					type: "dom" as const,
					render: domRender,
				},
			},
		});

		await waitFor(() => {
			expect(
				rendered.container.querySelector(".cosense-card-links__box-preview")
					?.textContent,
			).toBe("first dom");
		});

		domText = "second dom";
		await rendered.rerender({
			file,
			getPreview,
			searchQuery: "",
			previewRefreshToken: 0,
			previewOverride: {
				type: "dom" as const,
				render: domRender,
			},
		});

		await waitFor(() => {
			expect(
				rendered.container.querySelector(".cosense-card-links__box-preview")
					?.textContent,
			).toBe("second dom");
		});
		expect(domRender).toHaveBeenCalledTimes(2);
		expect(getPreview).not.toHaveBeenCalled();
	});

	it("keeps the current dom preview component loaded when unrelated settings change", async () => {
		const file = createMockTFile("notes/dom-settings.md");
		const applicationStore = createReactiveApplicationStore();
		state.appContext.applicationStore = applicationStore;
		const getPreview = vi.fn(async () => ({
			type: "empty" as const,
			content: "",
		}));
		const previewOverride = {
			type: "dom" as const,
			render: vi.fn(async (container: HTMLElement) => {
				container.textContent = "stable dom";
			}),
		};

		const rendered = render(CardPreview, {
			props: {
				file,
				getPreview,
				searchQuery: "",
				previewOverride,
			},
		});

		await waitFor(() => {
			expect(
				rendered.container.querySelector(".cosense-card-links__box-preview")
					?.textContent,
			).toBe("stable dom");
		});
		state.componentUnload.mockClear();

		applicationStore.setSettings(createSettings({ language: "ja" }));
		await tick();

		expect(previewOverride.render).toHaveBeenCalledTimes(1);
		expect(state.componentUnload).not.toHaveBeenCalled();
		expect(
			rendered.container.querySelector(".cosense-card-links__box-preview")
				?.textContent,
		).toBe("stable dom");
	});

	it("rerenders when preview content changes", async () => {
		const file = createMockTFile("notes/preview-invalidation.md");
		const getPreview = vi
			.fn()
			.mockResolvedValueOnce({
				type: "text" as const,
				content: "first preview",
			})
			.mockResolvedValueOnce({
				type: "text" as const,
				content: "updated preview",
			});

		let previewRenderVersion = "0:0";
		const getPreviewRenderVersion = vi.fn(() => previewRenderVersion);

		state.appContext.applicationStore = {
			settings: createSettings(),
			updateVersion: 0,
			getPreviewRenderVersion,
		} as unknown as ApplicationStore;

		const firstRender = render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			expect(
				document.querySelector(".cosense-card-links__box-preview")?.textContent,
			).toContain("rendered:first preview");
		});

		firstRender.unmount();
		previewRenderVersion = "0:1";

		render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			expect(
				document.querySelector(".cosense-card-links__box-preview")?.textContent,
			).toContain("rendered:updated preview");
		});
		expect(getPreview).toHaveBeenNthCalledWith(1, file, expect.any(AbortSignal), {
			cacheRevision: "0:0:0",
		});
		expect(getPreview).toHaveBeenNthCalledWith(2, file, expect.any(AbortSignal), {
			cacheRevision: "0:1:0",
		});
	});

	it("renders an empty preview when the debug flag is enabled", async () => {
		state.disableCardDomPreview = true;

		const file = createMockTFile("notes/dom-preview.md");
		const domRender = vi.fn(async (container: HTMLElement) => {
			container.textContent = "dom preview";
		});
		const getPreview = vi.fn(async () => ({
			type: "dom" as const,
			render: domRender,
		}));

		render(CardPreview, {
			props: { file, getPreview, searchQuery: "" },
		});

		await waitFor(() => {
			expect(getPreview).not.toHaveBeenCalled();
			expect(domRender).not.toHaveBeenCalled();
		});

		expect(document.querySelector(".cosense-card-links__box-preview")).toBeNull();
	});
});
