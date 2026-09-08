import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

type ObsidianModule = typeof import("obsidian");
type ProcessPreviewContent =
	(typeof import("../renderers/markdownPreviewRenderer"))["processPreviewContent"];

let finishRenderMath: ObsidianModule["finishRenderMath"];
let renderMath: ObsidianModule["renderMath"];
let sanitizeHTMLToDom: ObsidianModule["sanitizeHTMLToDom"];
let processPreviewContent: ProcessPreviewContent;

function sanitizeTestHtmlToDom(html: string): DocumentFragment {
	const template = document.createElement("template");
	template.innerHTML = html;

	for (const element of template.content.querySelectorAll(
		"script, iframe, object, embed",
	)) {
		element.remove();
	}

	for (const element of template.content.querySelectorAll("*")) {
		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value.trim().toLowerCase();
			if (name.startsWith("on") || value.startsWith("javascript:")) {
				element.removeAttribute(attribute.name);
			}
		}
	}

	return template.content;
}

function createObsidianMock() {
	return {
		renderMath: vi.fn((content: string, displayMode: boolean) => {
			const span = document.createElement("span");
			span.className = displayMode ? "math-block" : "math-inline";
			span.textContent = content;
			return span;
		}),
		finishRenderMath: vi.fn(),
		sanitizeHTMLToDom: vi.fn(sanitizeTestHtmlToDom),
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
		sanitizeHTMLToDom = obsidian.sanitizeHTMLToDom;
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

	test("sanitizes preview HTML before inserting it into the DOM", async () => {
		const content = [
			'<span class="cosense-card-links__wikilink">Safe link</span>',
			'<img src="x" onerror="globalThis.compromised = true">',
			"<script>globalThis.compromised = true</script>",
			'<a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>',
		].join("");

		await processPreviewContent(containerEl, content);

		expect(sanitizeHTMLToDom).toHaveBeenCalledWith(content);
		expect(containerEl.querySelector("script")).toBeNull();
		expect(containerEl.querySelector("[onerror], [onclick]")).toBeNull();
		expect(containerEl.querySelector("[href^='javascript:']")).toBeNull();
		expect(
			containerEl.querySelector(".cosense-card-links__wikilink")?.textContent,
		).toBe("Safe link");
	});

	test("sanitizes HTML fragments around rendered math", async () => {
		const content =
			'<img src="x" onerror="alert(1)">before $x^2$ after' +
			'<svg onload="alert(1)"></svg><iframe src="https://example.com"></iframe>';

		await processPreviewContent(containerEl, content);

		expect(sanitizeHTMLToDom).toHaveBeenCalledTimes(2);
		expect(containerEl.querySelector(".math-inline")?.textContent).toBe("x^2");
		expect(containerEl.querySelector("[onerror], [onload]")).toBeNull();
		expect(containerEl.querySelector("iframe")).toBeNull();
	});

	test("sanitizes dollar-containing content without a math expression", async () => {
		const content = 'Price \\$5 <object data="unsafe"></object>';

		await processPreviewContent(containerEl, content);

		expect(sanitizeHTMLToDom).toHaveBeenCalledTimes(1);
		expect(containerEl.textContent).toContain("Price $5");
		expect(containerEl.querySelector("object")).toBeNull();
	});
});
