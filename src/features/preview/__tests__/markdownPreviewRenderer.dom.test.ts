import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { finishRenderMath, MarkdownRenderer, renderMath } from "obsidian";
import { processPreviewContent } from "../renderers/markdownPreviewRenderer";

vi.mock("obsidian", () => {
	class MockComponent {
		load() {}
		unload() {}
	}

	return {
		renderMath: vi.fn((content: string, displayMode: boolean) => {
			const span = document.createElement("span");
			span.className = displayMode ? "math-block" : "math-inline";
			span.textContent = content;
			return span;
		}),
		finishRenderMath: vi.fn(),
		Component: MockComponent,
		MarkdownRenderer: {
			render: vi.fn().mockResolvedValue(undefined),
		},
	};
});

HTMLElement.prototype.createSpan = function (this: HTMLElement) {
	const span = document.createElement("span");
	this.appendChild(span);
	return span;
} as typeof HTMLElement.prototype.createSpan;

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

describe("processPreviewContent DOM rendering", () => {
	let containerEl: HTMLElement;
	let mockApp: never;
	let mockComponent: never;

	beforeEach(() => {
		containerEl = document.createElement("div");
		mockApp = {} as never;
		mockComponent = { load: vi.fn(), unload: vi.fn() } as never;
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.mocked(MarkdownRenderer.render).mockReset().mockResolvedValue(undefined);
	});

	test("renders math through Obsidian math APIs", async () => {
		const content = "Inline $x^2$ and block $$y^2$$";
		await processPreviewContent(
			containerEl,
			content,
			mockApp,
			"",
			mockComponent,
		);

		expect(renderMath).toHaveBeenCalledWith("x^2", false);
		expect(renderMath).toHaveBeenCalledWith("y^2", true);
		expect(finishRenderMath).toHaveBeenCalledTimes(1);
		const inlineMath = containerEl.querySelectorAll(".math-inline");
		const blockMath = containerEl.querySelectorAll(".math-block");
		expect(inlineMath).toHaveLength(1);
		expect(blockMath).toHaveLength(1);
	});

	test("renders preview content without math APIs when math rendering is disabled", async () => {
		const content = "Text before $$\\frac{1}{2} + target$$ text after";

		await processPreviewContent(
			containerEl,
			content,
			mockApp,
			"",
			mockComponent,
			{ enableMathRendering: false },
		);

		expect(renderMath).not.toHaveBeenCalled();
		expect(containerEl.textContent).toContain("$$\\frac{1}{2} + target$$");
	});

	test("twohop-render-block starts rendering in parallel", async () => {
		const content = [
			'<div class="twohop-render-block" data-lang="js" data-code="console.log(1);"></div>',
			'<div class="twohop-render-block" data-lang="ts" data-code="console.log(2);"></div>',
		].join(" ");
		const renderMock = vi.mocked(MarkdownRenderer.render);
		const deferreds: ReturnType<typeof createDeferred<void>>[] = [];

		renderMock.mockImplementation(() => {
			const deferred = createDeferred<void>();
			deferreds.push(deferred);
			return deferred.promise;
		});

		const promise = processPreviewContent(
			containerEl,
			content,
			mockApp,
			"note.md",
			mockComponent,
			{ enableMathRendering: false },
		);

		await Promise.resolve();

		expect(renderMock).toHaveBeenCalledTimes(2);
		expect(deferreds).toHaveLength(2);

		deferreds[0].resolve();
		deferreds[1].resolve();
		await promise;
	});

	test("does not start subsequent render block processing after abort", async () => {
		const abortController = new AbortController();
		const content = [
			"$x$",
			'<div class="twohop-render-block" data-lang="js" data-code="console.log(1);"></div>',
		].join(" ");

		vi.mocked(finishRenderMath).mockImplementationOnce(async () => {
			abortController.abort();
		});

		await processPreviewContent(
			containerEl,
			content,
			mockApp,
			"note.md",
			mockComponent,
			{ signal: abortController.signal },
		);

		expect(MarkdownRenderer.render).not.toHaveBeenCalled();
	});
});
