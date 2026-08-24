import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCardPreviewSharedCache } from "../cardPreviewSharedCache";
import { buildPreviewRenderKey } from "preview/pipeline/previewRenderKeys";
import {
	createPreviewRenderSettings,
	type PreviewRenderSettings,
} from "preview/pipeline/previewRenderSettings";
import { DEFAULT_SETTINGS, type PluginSettings } from "settings/model";
import { createMockTFile } from "testing/__mocks__/testHelpers";

const state = vi.hoisted(() => ({
	highlightSearchMatchesInHtml: vi.fn(),
	getContentSnippet: vi.fn(),
	findCaseInsensitiveIndex: vi.fn(),
	htmlVisibleTextContainsCaseInsensitive: vi.fn(),
	getFileContent: vi.fn(),
	analyzePreviewContent: vi.fn(),
}));
const sharedCache = createCardPreviewSharedCache();
const { applySharedSearchContextToTextPreview } = sharedCache;
const clearCardPreviewSharedCaches = sharedCache.clear;

vi.mock("preview/text/searchHighlighter", () => ({
	highlightSearchMatchesInHtml: state.highlightSearchMatchesInHtml,
}));

vi.mock("preview/text/snippetExtractor", () => ({
	getContentSnippet: state.getContentSnippet,
}));

vi.mock("preview/text/previewTextProcessingAsync", () => ({
	getContentSnippetAsync: state.getContentSnippet,
	highlightSearchMatchesInHtmlAsync: state.highlightSearchMatchesInHtml,
}));

vi.mock("preview/text/searchUtils", () => ({
	findCaseInsensitiveIndex: state.findCaseInsensitiveIndex,
	htmlVisibleTextContainsCaseInsensitive:
		state.htmlVisibleTextContainsCaseInsensitive,
}));

vi.mock("preview/pipeline/previewContent", () => ({
	getFileContent: state.getFileContent,
	analyzePreviewContent: state.analyzePreviewContent,
}));

function createSettings(
	overrides: Partial<PluginSettings> = {},
): PreviewRenderSettings {
	return createPreviewRenderSettings({
		...DEFAULT_SETTINGS,
		...overrides,
	});
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return { promise, resolve, reject };
}

describe("cardPreviewSharedCache search context", () => {
	beforeEach(() => {
		clearCardPreviewSharedCaches();

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
			(html: string, query: string) =>
				html.toLowerCase().includes(query.toLowerCase()),
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
	});

	it("reuses shared search context when render key is unchanged", async () => {
		const file = createMockTFile("notes/search-content-fingerprint.md");
		const settings = createSettings();
		const cacheKey = "preview-id:stable";

		const first = await applySharedSearchContextToTextPreview({
			previewContent: "<p>alpha first</p>",
			cacheKey,
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
		});
		const second = await applySharedSearchContextToTextPreview({
			previewContent: "<p>alpha first</p>",
			cacheKey,
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
		});

		expect(first).toBe("<mark><p>alpha first</p></mark>");
		expect(second).toBe("<mark><p>alpha first</p></mark>");
		expect(state.highlightSearchMatchesInHtml).toHaveBeenCalledTimes(1);
		expect(state.getFileContent).not.toHaveBeenCalled();
	});

	it("separates shared search context entries by render key", async () => {
		const file = createMockTFile("notes/search-content-fingerprint.md");
		const settings = createSettings();

		const first = await applySharedSearchContextToTextPreview({
			previewContent: "<p>alpha first</p>",
			cacheKey: "preview-id:first",
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
		});
		const second = await applySharedSearchContextToTextPreview({
			previewContent: "<p>alpha second</p>",
			cacheKey: "preview-id:second",
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
		});

		expect(first).toBe("<mark><p>alpha first</p></mark>");
		expect(second).toBe("<mark><p>alpha second</p></mark>");
		expect(state.highlightSearchMatchesInHtml).toHaveBeenCalledTimes(2);
		expect(state.getFileContent).not.toHaveBeenCalled();
	});

	it("separates render cache keys by preview content settings", () => {
		const file = createMockTFile("notes/render-settings.md");
		const first = buildPreviewRenderKey(
			file,
			"alpha",
			createSettings({ previewMaxChars: 100 }),
			"render-v1",
		);
		const second = buildPreviewRenderKey(
			file,
			"alpha",
			createSettings({ previewMaxChars: 200 }),
			"render-v1",
		);
		const third = buildPreviewRenderKey(
			file,
			"alpha",
			createSettings({ previewMaxChars: 200 }),
			"render-v1",
		);

		expect(first).not.toBe(second);
		expect(second).toBe(third);
	});

	it("uses provided first match offset instead of searching raw content", async () => {
		const file = createMockTFile("notes/search-offset.md");
		const settings = createSettings();

		await applySharedSearchContextToTextPreview({
			previewContent: "<p>fallback preview</p>",
			cacheKey: "preview-id:with-offset",
			targetFile: file,
			normalizedQuery: "alpha",
			firstMatchOffset: 7,
			settings,
			vault: {} as never,
		});

		expect(state.getContentSnippet).toHaveBeenCalledWith(
			"before alpha after",
			settings,
			"alpha",
			{ firstMatchIndex: 7 },
			expect.any(AbortSignal),
		);
		// findCaseInsensitiveIndex is no longer called from previewContentHasVisibleQuery
		// (uses htmlVisibleTextContainsCaseInsensitive instead) and is skipped in
		// resolveFirstMatchIndex when firstMatchOffset is provided.
		expect(state.findCaseInsensitiveIndex).toHaveBeenCalledTimes(0);
	});

	it("does not retain raw full content for large files", async () => {
		const file = createMockTFile("notes/large-search.md");
		file.stat.size = 300 * 1024;
		const settings = createSettings();

		await applySharedSearchContextToTextPreview({
			previewContent: "<p>fallback preview</p>",
			cacheKey: "preview-id:first-large",
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
		});
		await applySharedSearchContextToTextPreview({
			previewContent: "<p>fallback preview</p>",
			cacheKey: "preview-id:second-large",
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
		});

		expect(state.getFileContent).toHaveBeenCalledTimes(2);
		expect(state.getContentSnippet).toHaveBeenCalledTimes(2);
	});

	it("does not let an aborted search context caller poison a later caller sharing the same in-flight work", async () => {
		const file = createMockTFile("notes/aborted-search-context.md");
		const settings = createSettings();
		const rawContent = createDeferred<string>();
		const controller = new AbortController();

		state.getFileContent.mockReturnValueOnce(rawContent.promise);

		const first = applySharedSearchContextToTextPreview({
			previewContent: "<p>fallback preview</p>",
			cacheKey: "preview-id:abort-shared",
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
			signal: controller.signal,
		});
		const firstRejection = expect(first).rejects.toMatchObject({
			name: "AbortError",
		});

		controller.abort();
		await firstRejection;

		const second = applySharedSearchContextToTextPreview({
			previewContent: "<p>fallback preview</p>",
			cacheKey: "preview-id:abort-shared",
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
		});

		rawContent.resolve("before alpha after");

		await expect(second).resolves.toBe("<mark>snippet:alpha:7</mark>");
		expect(state.getContentSnippet).toHaveBeenCalledTimes(1);
		expect(state.highlightSearchMatchesInHtml).toHaveBeenCalledWith(
			"snippet:alpha:7",
			"alpha",
			expect.any(AbortSignal),
		);
	});

	it("stops search context work before snippet generation when the only caller aborts", async () => {
		const file = createMockTFile("notes/aborted-before-snippet.md");
		const settings = createSettings();
		const rawContent = createDeferred<string>();
		const controller = new AbortController();

		state.getFileContent.mockReturnValueOnce(rawContent.promise);

		const request = applySharedSearchContextToTextPreview({
			previewContent: "<p>fallback preview</p>",
			cacheKey: "preview-id:abort-before-snippet",
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
			signal: controller.signal,
		});

		rawContent.resolve("before alpha after");
		controller.abort();

		await expect(request).rejects.toMatchObject({ name: "AbortError" });
		expect(state.getContentSnippet).not.toHaveBeenCalled();
		expect(state.highlightSearchMatchesInHtml).not.toHaveBeenCalled();
	});

	it("aborts in-flight search context work when shared caches are cleared", async () => {
		const file = createMockTFile("notes/clear-search-context.md");
		const settings = createSettings();
		const highlightFinished = createDeferred<string>();

		state.highlightSearchMatchesInHtml.mockReturnValueOnce(
			highlightFinished.promise,
		);

		const first = applySharedSearchContextToTextPreview({
			previewContent: "<p>alpha first</p>",
			cacheKey: "preview-id:clear-search-context",
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
		});

		await vi.waitFor(() => {
			expect(state.highlightSearchMatchesInHtml).toHaveBeenCalledTimes(1);
		});

		clearCardPreviewSharedCaches();
		highlightFinished.resolve("<mark><p>stale alpha</p></mark>");

		await expect(first).rejects.toMatchObject({ name: "AbortError" });

		const second = await applySharedSearchContextToTextPreview({
			previewContent: "<p>alpha first</p>",
			cacheKey: "preview-id:clear-search-context",
			targetFile: file,
			normalizedQuery: "alpha",
			settings,
			vault: {} as never,
		});

		expect(second).toBe("<mark><p>alpha first</p></mark>");
		expect(state.highlightSearchMatchesInHtml).toHaveBeenCalledTimes(2);
	});
});
