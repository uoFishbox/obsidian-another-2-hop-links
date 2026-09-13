import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import {
	resetMathShadowStylesStateForTests,
	syncMathStylesForNode,
} from "shared/ui/dom/mathShadowStyles";
import { ensureCardRenderShadowSurface } from "../cardRenderShadowSurface";
import {
	collectShadowStyleText,
	createShadowSurfaceFixture,
} from "./cardRenderShadowSurfaceTestHelpers";

const BASE_CSS_MARKER = ".cosense-card-links__virtual-grid-content";

describe("cardRenderShadowSurface", () => {
	it("reuses one shadow root and surface element per host", () => {
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
		// The surface inherits the host's class tokens so the shipped stylesheet
		// keeps matching it.
		expect(first?.surfaceEl.className).toContain(
			"cosense-card-links__virtual-grid",
		);
		expect(first?.surfaceEl.className).toContain("cosense-card-links__section");
		expect(first?.surfaceEl.className).toContain("twohop-links-new-links");
		expect(collectShadowStyleText(first?.shadowRoot as ShadowRoot)).toContain(
			BASE_CSS_MARKER,
		);

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
		expect(handles.shadowRoot.querySelector("style")?.ownerDocument).toBe(
			iframeDocument,
		);

		handles.dispose();
		iframe.remove();
	});

	it("appends, updates, and removes custom CSS independently of base styles", () => {
		const host = document.createElement("div");
		const firstCss = ".card { color: red; }";
		const secondCss = ".card { color: blue; }";

		const handles = ensureCardRenderShadowSurface(host, firstCss);
		expect(collectShadowStyleText(handles.shadowRoot)).toContain(firstCss);

		ensureCardRenderShadowSurface(host, secondCss).dispose();
		const updatedCss = collectShadowStyleText(handles.shadowRoot);
		expect(updatedCss).toContain(secondCss);
		expect(updatedCss).not.toContain(firstCss);

		ensureCardRenderShadowSurface(host, "").dispose();
		const clearedCss = collectShadowStyleText(handles.shadowRoot);
		expect(clearedCss).not.toContain(secondCss);
		// Dropping the custom CSS must not take the base stylesheet with it.
		expect(clearedCss).toContain(BASE_CSS_MARKER);

		handles.dispose();
	});
});

describe("cardRenderShadowSurface math styles (Temml host)", () => {
	beforeEach(() => {
		vi.spyOn(obsidian, "requireApiVersion").mockImplementation(
			(version) => version === "1.14.0",
		);
		resetMathShadowStylesStateForTests();
	});

	afterEach(() => {
		resetMathShadowStylesStateForTests();
		vi.restoreAllMocks();
	});

	it("makes Temml math styles available inside the surface", () => {
		const { host, root } = createShadowSurfaceFixture();
		const handles = ensureCardRenderShadowSurface(host);
		handles.surfaceEl.innerHTML =
			'<div class="math-rendered"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></div>';

		expect(syncMathStylesForNode(handles.surfaceEl)).toBe(true);
		// Probing the host API is how the surface decides which mechanism to use.
		expect(obsidian.requireApiVersion).toHaveBeenCalledWith("1.14.0");
		expect(obsidian.requireApiVersion).toHaveBeenCalledWith("1.14.1");

		const css = Array.from(root.adoptedStyleSheets[0].cssRules)
			.map((rule) => rule.cssText)
			.join("\n");
		expect(css).toContain('"Latin Modern Math"');
		expect(css).toContain("math.tml-display");
		expect(css).toContain(":host");
	});
});
