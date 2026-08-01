import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCardPreviewSharedCache,
} from "../cardPreviewSharedCache";

const state = vi.hoisted(() => ({
	processPreviewContent: vi.fn(),
}));
const sharedCache = createCardPreviewSharedCache();
const { cloneRenderedPreviewContent, getOrCreateRenderedTextPreviewEntry } =
	sharedCache;
const clearCardPreviewSharedCaches = sharedCache.clear;

vi.mock("features/preview/renderers/markdownPreviewRenderer", () => ({
	processPreviewContent: state.processPreviewContent,
}));

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return { promise, resolve, reject };
}

describe("cardPreviewSharedCache render entries", () => {
	beforeEach(() => {
		clearCardPreviewSharedCaches();

		state.processPreviewContent.mockReset();
		state.processPreviewContent.mockImplementation(
			async (element: HTMLElement, content: string) => {
				element.innerHTML = `<p>rendered:${content}</p>`;
			},
		);
	});

	it("aborts single-caller render work and allows a later caller to render fresh", async () => {
		const renderFinished = createDeferred<void>();
		const controller = new AbortController();
		let sharedSignal: AbortSignal | undefined;

		state.processPreviewContent.mockImplementationOnce(
			async (
				element: HTMLElement,
				content: string,
				_app: unknown,
				_sourcePath: string,
				_component: unknown,
				options: { signal?: AbortSignal },
			) => {
				sharedSignal = options.signal;
				expect(sharedSignal).toBeInstanceOf(AbortSignal);
				await renderFinished.promise;
				element.innerHTML = `<p>rendered:${content}</p>`;
			},
		);

		const first = getOrCreateRenderedTextPreviewEntry({
			cacheKey: "render-cache:abort-shared",
			content: "preview text",
			app: {} as never,
			sourcePath: "notes/aborted-render.md",
			enableMathRendering: false,
			signal: controller.signal,
		});
		const firstRejection = expect(first).rejects.toMatchObject({
			name: "AbortError",
		});

		await vi.waitFor(() => {
			expect(sharedSignal).toBeInstanceOf(AbortSignal);
		});
		controller.abort();
		await firstRejection;
		expect(sharedSignal?.aborted).toBe(true);

		const second = getOrCreateRenderedTextPreviewEntry({
			cacheKey: "render-cache:abort-shared",
			content: "preview text",
			app: {} as never,
			sourcePath: "notes/aborted-render.md",
			enableMathRendering: false,
		});

		renderFinished.resolve();

		const entry = await second;
		expect(entry).toMatchObject({
			kind: "text",
			html: "<p>rendered:preview text</p>",
			hasMath: false,
		});
		expect(entry.estimatedBytes).toBeGreaterThan(entry.html.length);
		expect(
			Object.values(entry).some((value: unknown) => value instanceof Node),
		).toBe(false);
		expect(state.processPreviewContent).toHaveBeenCalledTimes(2);
	});

	it("keeps a replacement request registered when an aborted predecessor settles", async () => {
		const firstFinished = createDeferred<void>();
		const secondFinished = createDeferred<void>();
		const firstController = new AbortController();
		let invocation = 0;

		state.processPreviewContent.mockImplementation(
			async (element: HTMLElement, content: string) => {
				invocation += 1;
				if (invocation === 1) await firstFinished.promise;
				if (invocation === 2) await secondFinished.promise;
				element.innerHTML = `<p>rendered:${content}</p>`;
			},
		);

		const params = {
			cacheKey: "render-cache:replacement-identity",
			content: "preview text",
			app: {} as never,
			sourcePath: "notes/replacement-render.md",
			enableMathRendering: false,
		};
		const first = getOrCreateRenderedTextPreviewEntry({
			...params,
			signal: firstController.signal,
		});
		const firstRejection = expect(first).rejects.toMatchObject({
			name: "AbortError",
		});

		await vi.waitFor(() => expect(invocation).toBe(1));
		firstController.abort();
		await firstRejection;
		const second = getOrCreateRenderedTextPreviewEntry(params);
		firstFinished.resolve();
		await vi.waitFor(() => expect(invocation).toBe(2));

		const third = getOrCreateRenderedTextPreviewEntry(params);
		await Promise.resolve();
		expect(invocation).toBe(2);
		secondFinished.resolve();

		const [secondEntry, thirdEntry] = await Promise.all([second, third]);
		expect(thirdEntry).toBe(secondEntry);
		expect(state.processPreviewContent).toHaveBeenCalledTimes(2);
	});

	it("aborts in-flight render work when shared caches are cleared", async () => {
		const renderFinished = createDeferred<void>();
		let sharedSignal: AbortSignal | undefined;

		state.processPreviewContent.mockImplementationOnce(
			async (
				element: HTMLElement,
				content: string,
				_app: unknown,
				_sourcePath: string,
				_component: unknown,
				options: { signal?: AbortSignal },
			) => {
				sharedSignal = options.signal;
				await renderFinished.promise;
				element.innerHTML = `<p>stale:${content}</p>`;
			},
		);

		const first = getOrCreateRenderedTextPreviewEntry({
			cacheKey: "render-cache:clear-shared",
			content: "preview text",
			app: {} as never,
			sourcePath: "notes/clear-render.md",
			enableMathRendering: false,
		});

		await vi.waitFor(() => {
			expect(sharedSignal).toBeInstanceOf(AbortSignal);
		});

		clearCardPreviewSharedCaches();
		expect(sharedSignal?.aborted).toBe(true);
		renderFinished.resolve();

		await expect(first).rejects.toMatchObject({ name: "AbortError" });

		const second = await getOrCreateRenderedTextPreviewEntry({
			cacheKey: "render-cache:clear-shared",
			content: "preview text",
			app: {} as never,
			sourcePath: "notes/clear-render.md",
			enableMathRendering: false,
		});

		expect(cloneRenderedPreviewContent(second).textContent).toBe(
			"rendered:preview text",
		);
		expect(state.processPreviewContent).toHaveBeenCalledTimes(2);
	});

	it("creates independent document fragments only when an entry is displayed", async () => {
		const entry = await getOrCreateRenderedTextPreviewEntry({
			cacheKey: "render-cache:static-html",
			content: "preview text",
			app: {} as never,
			sourcePath: "notes/static-html.md",
			enableMathRendering: false,
		});
		const createElement = vi.spyOn(document, "createElement");

		const first = cloneRenderedPreviewContent(entry);
		const second = cloneRenderedPreviewContent(entry);

		expect(first).not.toBe(second);
		expect(first.firstChild).not.toBe(second.firstChild);
		expect(first.textContent).toBe("rendered:preview text");
		expect(second.textContent).toBe("rendered:preview text");
		expect(createElement).toHaveBeenCalledOnce();
		expect(createElement).toHaveBeenCalledWith("template");
		createElement.mockRestore();
	});
});
