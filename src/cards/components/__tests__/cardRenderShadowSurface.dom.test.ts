import { beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import {
	resetMathShadowStylesStateForTests,
	syncMathStylesForNode,
} from "shared/ui/dom/mathShadowStyles";
import { ensureCardRenderShadowSurface } from "../cardRenderShadowSurface";

describe("cardRenderShadowSurface", () => {
	it("reuses the same shadow root, style element, and surface element", () => {
		const sectionHost = document.createElement("div");
		sectionHost.className = "cosense-card-links__section twohop-links-new-links";
		const host = document.createElement("div");
		host.className = "cosense-card-links__virtual-grid";
		sectionHost.append(host);
		document.body.append(sectionHost);

		const first = ensureCardRenderShadowSurface(host);
		const second = ensureCardRenderShadowSurface(host);

		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(second?.shadowRoot).toBe(first?.shadowRoot);
		expect(second?.surfaceEl).toBe(first?.surfaceEl);
		expect(host.shadowRoot).toBe(first?.shadowRoot);
		expect(
			host.shadowRoot?.querySelectorAll(
				"style[data-ccl-card-render-shadow-base-style]",
			),
		).toHaveLength(1);
		expect(
			host.shadowRoot?.querySelectorAll(
				"div[data-ccl-card-render-shadow-surface]",
			),
		).toHaveLength(1);
		expect(first?.surfaceEl.className).toContain(
			"cosense-card-links__virtual-grid",
		);
		expect(first?.surfaceEl.className).toContain("cosense-card-links__section");
		expect(first?.surfaceEl.className).toContain("twohop-links-new-links");
		expect(
			host.shadowRoot?.querySelector(
				"style[data-ccl-card-render-shadow-base-style]",
			)?.textContent,
		).toContain(".cosense-card-links__virtual-grid-content");
		expect(
			host.shadowRoot?.querySelector(
				"style[data-ccl-card-render-shadow-base-style]",
			)?.textContent,
		).toContain(".cosense-card-links__virtual-grid-content");

		first?.dispose();
		second?.dispose();
		sectionHost.remove();
	});

	it("unregisters the shadow root from MathJax when disposed", () => {
		const sourceStyle = document.createElement("style");
		sourceStyle.id = "MJX-CHTML-styles";
		sourceStyle.textContent = "mjx-container { display: inline-block; }";
		document.head.append(sourceStyle);
		const chtmlStylesheet = vi.fn(() => {
			throw new Error("should not be called");
		});
		(globalThis as { MathJax?: unknown }).MathJax = {
			chtmlStylesheet,
		};

		const host = document.createElement("div");
		const handles = ensureCardRenderShadowSurface(host);
		const mathEl = document.createElement("mjx-container");
		handles?.shadowRoot.append(mathEl);

		handles?.dispose();

		expect(syncMathStylesForNode(mathEl)).toBe(false);
		expect(chtmlStylesheet).not.toHaveBeenCalled();

		sourceStyle.remove();
		host.remove();
	});

	it("creates shadow surface elements in the host document realm", () => {
		const iframe = document.createElement("iframe");
		document.body.append(iframe);
		const iframeDocument = iframe.contentDocument;
		expect(iframeDocument).not.toBeNull();
		if (!iframeDocument) return;

		const host = iframeDocument.createElement("div");
		iframeDocument.body.append(host);

		const handles = ensureCardRenderShadowSurface(host);

		expect(handles.shadowRoot.ownerDocument).toBe(iframeDocument);
		expect(handles.surfaceEl.ownerDocument).toBe(iframeDocument);
		expect(
			handles.shadowRoot.querySelector(
				"style[data-ccl-card-render-shadow-base-style]",
			)?.ownerDocument,
		).toBe(iframeDocument);

		handles.dispose();
		iframe.remove();
	});
});

describe("cardRenderShadowSurface math styles (Temml)", () => {
	beforeEach(() => {
		vi.spyOn(obsidian, "requireApiVersion").mockReturnValue(true);
		resetMathShadowStylesStateForTests();
	});

	afterEach(() => {
		resetMathShadowStylesStateForTests();
		vi.restoreAllMocks();
	});

	function createSurface(ownerDocument: Document = document) {
		const host = ownerDocument.createElement("div");
		ownerDocument.body.append(host);
		const root = host.attachShadow({ mode: "open" });
		// jsdom parses constructed CSS but does not implement adoption yet.
		Object.defineProperty(root, "adoptedStyleSheets", {
			value: [],
			writable: true,
			configurable: true,
		});
		return { host, root };
	}

	it("shares one parsed stylesheet across cards without MathJax or style clones", () => {
		const replace = vi.spyOn(CSSStyleSheet.prototype, "replaceSync");
		const first = createSurface();
		const second = createSurface();
		const firstSurface = ensureCardRenderShadowSurface(first.host);
		ensureCardRenderShadowSurface(second.host);
		ensureCardRenderShadowSurface(first.host);
		firstSurface.surfaceEl.innerHTML =
			'<div class="math-rendered"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></div>';
		expect(syncMathStylesForNode(firstSurface.surfaceEl)).toBe(true);
		expect(first.root.adoptedStyleSheets).toHaveLength(1);
		expect(first.root.adoptedStyleSheets[0]).toBe(
			second.root.adoptedStyleSheets[0],
		);
		expect(replace).toHaveBeenCalledTimes(1);
		expect(obsidian.requireApiVersion).toHaveBeenCalledWith("1.14.0");
		expect(first.root.querySelectorAll("style")).toHaveLength(1);
		expect(
			first.root.querySelector("style[data-ccl-mathjax-shadow-style]"),
		).toBeNull();
		const css = Array.from(first.root.adoptedStyleSheets[0].cssRules)
			.map((rule) => rule.cssText)
			.join("\n");
		expect(css).toContain('"Latin Modern Math"');
		expect(css).toContain("math.tml-display");
		expect(css).toContain(".tml-sml-pad");
		expect(css).toContain(".tml-cancelto");
		expect(css).toContain(".chr-med");
		expect(css).toContain(".wbk-med");
		expect(css).toContain(".ff-narrow");
		expect(css).toContain(":host");
		expect(css).toContain("content: none");
		expect(css).not.toContain("@font-face");
		expect(css).not.toContain("public/fonts/");
	});

	it("disposal removes only its own sheet and allows the surface to be reused", () => {
		const { host, root } = createSurface();
		const otherSheet = new CSSStyleSheet();
		root.adoptedStyleSheets = [otherSheet];
		const handles = ensureCardRenderShadowSurface(host);
		const sharedSheet = root.adoptedStyleSheets[1];
		expect(root.adoptedStyleSheets).toHaveLength(2);
		handles.dispose();
		handles.dispose();
		expect(syncMathStylesForNode(handles.surfaceEl)).toBe(false);
		expect(root.adoptedStyleSheets).toEqual([otherSheet]);
		ensureCardRenderShadowSurface(host);
		expect(root.adoptedStyleSheets).toEqual([otherSheet, sharedSheet]);
	});
});
