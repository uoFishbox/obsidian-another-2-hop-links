import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
	class MarkdownRenderChild {
		onunload: () => void = () => {};

		constructor(public readonly containerEl: HTMLElement) {}

		unload(): void {
			this.onunload();
		}
	}

	return {
		MarkdownRenderChild,
	};
});

import { MarkdownRenderChild } from "obsidian";
import { RenderedMdElementsRegistry } from "../RenderedMdElementsRegistry";

function createContext(sourcePath = "notes/example.md") {
	const children: MarkdownRenderChild[] = [];
	const ctx = {
		sourcePath,
		addChild(child: MarkdownRenderChild) {
			children.push(child);
		},
	};

	return {
		ctx: ctx as any,
		children,
	};
}

describe("RenderedMdElementsRegistry", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("prunes disconnected elements during reprocess", () => {
		const stylingService = {
			decorateLinksInContainer: vi.fn(),
		};
		const registry = new RenderedMdElementsRegistry(stylingService as any);
		const { ctx: connectedCtx } = createContext();
		const { ctx: disconnectedCtx } = createContext();

		const connectedEl = document.createElement("div");
		document.body.appendChild(connectedEl);
		const disconnectedEl = document.createElement("div");

		registry.registerElement("notes/example.md", connectedEl, connectedCtx);
		registry.registerElement("notes/example.md", disconnectedEl, disconnectedCtx);

		registry.reprocessDecorations("notes/example.md");

		expect(stylingService.decorateLinksInContainer).toHaveBeenCalledTimes(1);
		expect(stylingService.decorateLinksInContainer).toHaveBeenCalledWith(
			connectedEl,
			"notes/example.md",
		);

		expect(registry.isTrackedElement("notes/example.md", connectedEl)).toBe(true);
		expect(registry.isTrackedElement("notes/example.md", disconnectedEl)).toBe(
			false,
		);
	});

	it("removes registered elements when MarkdownRenderChild unloads", () => {
		const registry = new RenderedMdElementsRegistry({
			decorateLinksInContainer: vi.fn(),
		} as any);
		const { ctx, children } = createContext();
		const el = document.createElement("div");

		registry.registerElement("notes/example.md", el, ctx);
		children[0].unload();

		expect(registry.isTrackedElement("notes/example.md", el)).toBe(false);
		expect(registry.getTrackedSourcePaths().has("notes/example.md")).toBe(false);
	});

	it("clears all tracked elements on destroy", () => {
		const registry = new RenderedMdElementsRegistry({
			decorateLinksInContainer: vi.fn(),
		} as any);
		const { ctx: firstCtx } = createContext("notes/first.md");
		const { ctx: secondCtx } = createContext("notes/second.md");

		registry.registerElement(
			"notes/first.md",
			document.createElement("div"),
			firstCtx,
		);
		registry.registerElement(
			"notes/second.md",
			document.createElement("div"),
			secondCtx,
		);

		registry.destroy();

		expect(registry.getTrackedSourcePaths().size).toBe(0);
	});
});
