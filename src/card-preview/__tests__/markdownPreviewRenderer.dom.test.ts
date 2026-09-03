import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

type ObsidianModule = typeof import("obsidian");
type ProcessPreviewContent =
	(typeof import("../renderers/markdownPreviewRenderer"))["processPreviewContent"];

let finishRenderMath: ObsidianModule["finishRenderMath"];
let renderMath: ObsidianModule["renderMath"];
let processPreviewContent: ProcessPreviewContent;

function createObsidianMock() {
	return {
		renderMath: vi.fn((content: string, displayMode: boolean) => {
			const span = document.createElement("span");
			span.className = displayMode ? "math-block" : "math-inline";
			span.textContent = content;
			return span;
		}),
		finishRenderMath: vi.fn(),
		requireApiVersion: vi.fn(() => false),
	};
}

HTMLElement.prototype.createSpan = function (this: HTMLElement) {
	const span = document.createElement("span");
	this.appendChild(span);
	return span;
} as typeof HTMLElement.prototype.createSpan;

describe("processPreviewContent DOM rendering", () => {
	let containerEl: HTMLElement;

	beforeEach(async () => {
		vi.resetModules();
		vi.doMock("obsidian", createObsidianMock);
		const obsidian = await import("obsidian");
		finishRenderMath = obsidian.finishRenderMath;
		renderMath = obsidian.renderMath;
		({ processPreviewContent } =
			await import("../renderers/markdownPreviewRenderer"));
		containerEl = document.createElement("div");
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.doUnmock("obsidian");
		vi.resetModules();
	});

	test("renders math through Obsidian math APIs", async () => {
		const content = "Inline $x^2$ and block $$y^2$$";
		await processPreviewContent(containerEl, content);

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

		await processPreviewContent(containerEl, content, {
			enableMathRendering: false,
		});

		expect(renderMath).not.toHaveBeenCalled();
		expect(containerEl.textContent).toContain("$$\\frac{1}{2} + target$$");
	});
});
