import { beforeEach, describe, expect, test, vi } from "vitest";
import { MarkdownRenderer } from "obsidian";
import { createMockTFileAsPlainObject } from "testing/__mocks__/testHelpers";
import { generateCanvasPreview } from "../canvasPreviewRenderer";
import { createMarkdownDomPreview } from "../domPreviewRenderer";

vi.mock("obsidian", () => ({
	MarkdownRenderer: {
		render: vi.fn().mockResolvedValue(undefined),
	},
}));

describe("createMarkdownDomPreview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(MarkdownRenderer.render).mockReset().mockResolvedValue(undefined);
	});

	test("renders directly to the target element using MarkdownRenderer", async () => {
		const app = {} as any;
		const component = {} as any;
		const preview = createMarkdownDomPreview(
			app,
			"note.md",
			"**hello**",
		);
		const container = document.createElement("div");

		expect(preview.type).toBe("dom");
		if (preview.type !== "dom") {
			throw new Error("Expected dom preview");
		}

		await preview.render(container, component);

		expect(MarkdownRenderer.render).toHaveBeenCalledWith(
			app,
			"**hello**",
			container,
			"note.md",
			component,
		);
	});

	test("uses fallbackHtml when render is empty", async () => {
		const app = {} as any;
		const preview = createMarkdownDomPreview(
			app,
			"note.md",
			"![](https://example.com)",
			{ fallbackHtml: "<p>fallback</p>" },
		);
		const container = document.createElement("div");

		if (preview.type !== "dom") {
			throw new Error("Expected dom preview");
		}

		await preview.render(container, {} as any);

		expect(container.innerHTML).toBe("<p>fallback</p>");
	});

	test("uses fallbackHtml even when render fails", async () => {
		const app = {} as any;
		const onError = vi.fn();
		vi.mocked(MarkdownRenderer.render).mockRejectedValueOnce(
			new Error("render failed"),
		);
		const preview = createMarkdownDomPreview(
			app,
			"note.md",
			"![](https://example.com)",
			{
				fallbackHtml: "<p>fallback</p>",
				onError,
			},
		);
		const container = document.createElement("div");

		if (preview.type !== "dom") {
			throw new Error("Expected dom preview");
		}

		await preview.render(container, {} as any);

		expect(onError).toHaveBeenCalledTimes(1);
		expect(container.innerHTML).toBe("<p>fallback</p>");
	});

	test("does not render if already aborted before start", async () => {
		const app = {} as any;
		const component = {} as any;
		const controller = new AbortController();
		const preview = createMarkdownDomPreview(
			app,
			"note.md",
			"**hello**",
		);
		const container = document.createElement("div");
		container.innerHTML = "<p>existing</p>";
		controller.abort();

		if (preview.type !== "dom") {
			throw new Error("Expected dom preview");
		}

		await preview.render(container, component, controller.signal);

		expect(MarkdownRenderer.render).not.toHaveBeenCalled();
		expect(container.innerHTML).toBe("<p>existing</p>");
	});

	test("clears rendered content without falling back when aborted after render", async () => {
		const app = {} as any;
		const component = {} as any;
		const controller = new AbortController();
		vi.mocked(MarkdownRenderer.render).mockImplementationOnce(
			async (_app, _markdown, container) => {
				container.innerHTML = "<p>rendered</p>";
				controller.abort();
			},
		);
		const preview = createMarkdownDomPreview(
			app,
			"note.md",
			"**hello**",
			{ fallbackHtml: "<p>fallback</p>" },
		);
		const container = document.createElement("div");

		if (preview.type !== "dom") {
			throw new Error("Expected dom preview");
		}

		await preview.render(container, component, controller.signal);

		expect(container.innerHTML).toBe("");
	});
});

describe("generateCanvasPreview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(MarkdownRenderer.render).mockReset().mockResolvedValue(undefined);
	});

	test("canvas returns dom preview and directly renders embed markdown", async () => {
		const file = createMockTFileAsPlainObject("board.canvas", "canvas");
		const app = {} as any;
		const component = {} as any;
		const preview = await generateCanvasPreview(file, app);
		const container = document.createElement("div");

		expect(preview?.type).toBe("dom");
		if (!preview || preview.type !== "dom") {
			throw new Error("Expected dom preview");
		}

		await preview.render(container, component);

		expect(MarkdownRenderer.render).toHaveBeenCalledWith(
			app,
			"![[board.canvas]]",
			container,
			"board.canvas",
			component,
		);
	});
});
