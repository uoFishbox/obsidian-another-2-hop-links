import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as obsidian from "obsidian";
import { ensureCardRenderShadowSurface } from "cards/components/cardRenderShadowSurface";
import {
	installMathShadowPatch,
	queueMathShadowStylesSync,
	registerMathShadowRoot,
	unregisterMathShadowRoot,
	resetMathShadowStylesStateForTests,
	syncMathStylesForNode,
	syncMathStylesToShadowRoot,
} from "../mathShadowStyles";

describe("mathShadowStyles", () => {
	beforeEach(() => {
		vi.spyOn(obsidian, "requireApiVersion").mockReturnValue(false);
		resetMathShadowStylesStateForTests();
		document.head.innerHTML = "";
		document.body.innerHTML = "";
		delete (globalThis as { MathJax?: unknown }).MathJax;
	});

	afterEach(() => {
		resetMathShadowStylesStateForTests();
		vi.restoreAllMocks();
	});

	test("copies the current MathJax CHTML stylesheet into a shadow root", () => {
		const sourceStyle = document.createElement("style");
		sourceStyle.id = "MJX-CHTML-styles";
		sourceStyle.textContent = "mjx-container { color: red; }";
		document.head.append(sourceStyle);

		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });

		expect(syncMathStylesToShadowRoot(shadowRoot)).toBe(true);

		const cloned = shadowRoot.querySelector<HTMLStyleElement>(
			"style[data-ccl-mathjax-shadow-style]",
		);
		expect(cloned).not.toBeNull();
		expect(cloned?.textContent).toContain("mjx-container { color: red; }");
	});

	test("uses the live MathJax document stylesheet for registered plugin shadow roots", () => {
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
		const shadowRoot = host.attachShadow({ mode: "open" });
		const mathEl = document.createElement("mjx-container");
		shadowRoot.append(mathEl);
		registerMathShadowRoot(shadowRoot);

		expect(syncMathStylesForNode(mathEl)).toBe(true);
		expect(chtmlStylesheet).not.toHaveBeenCalled();
		const cloned = shadowRoot.querySelector<HTMLStyleElement>(
			"style[data-ccl-mathjax-shadow-style]",
		);
		expect(cloned?.textContent).toContain(
			"mjx-container { display: inline-block; }",
		);
	});

	test("stops syncing a shadow root after it is unregistered", () => {
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
		const shadowRoot = host.attachShadow({ mode: "open" });
		const mathEl = document.createElement("mjx-container");
		shadowRoot.append(mathEl);
		registerMathShadowRoot(shadowRoot);
		unregisterMathShadowRoot(shadowRoot);

		expect(syncMathStylesForNode(mathEl)).toBe(false);
		expect(chtmlStylesheet).not.toHaveBeenCalled();
		expect(
			shadowRoot.querySelector("style[data-ccl-mathjax-shadow-style]"),
		).toBeNull();
	});

	test("patches MathJax updateDocument to queue shadow root sync", async () => {
		const sourceStyle = document.createElement("style");
		sourceStyle.id = "MJX-CHTML-styles";
		sourceStyle.textContent = "mjx-container { color: red; }";
		document.head.append(sourceStyle);
		const chtmlStylesheet = vi.fn(() => sourceStyle);

		const updateDocument = () => {
			sourceStyle.textContent = [
				"mjx-container { color: red; }",
				"mjx-c1D44E { font-style: italic; }",
			].join("\n");
		};

		const mathJax = {
			chtmlStylesheet,
			startup: {
				document: {
					updateDocument,
				},
			},
		};
		(globalThis as { MathJax?: unknown }).MathJax = mathJax;

		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });
		document.body.append(host);
		registerMathShadowRoot(shadowRoot);
		syncMathStylesToShadowRoot(shadowRoot);

		installMathShadowPatch();
		mathJax.startup.document.updateDocument();
		queueMathShadowStylesSync();
		await new Promise((resolve) => window.setTimeout(resolve, 20));

		const cloned = shadowRoot.querySelector<HTMLStyleElement>(
			"style[data-ccl-mathjax-shadow-style]",
		);
		expect(chtmlStylesheet).not.toHaveBeenCalled();
		expect(cloned?.textContent).toContain("mjx-c1D44E");
	});

	describe("Temml", () => {
		beforeEach(() => {
			vi.mocked(obsidian.requireApiVersion).mockReturnValue(true);
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

		test("shares one parsed stylesheet across cards without MathJax or style clones", () => {
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

		test("creates separate shared sheets for each window's document", () => {
			const iframe = document.createElement("iframe");
			document.body.append(iframe);
			const otherDocument = iframe.contentDocument!;
			const otherSheet = otherDocument.defaultView!.CSSStyleSheet;
			const createSheet = vi.spyOn(otherSheet.prototype, "replaceSync");
			const first = createSurface();
			const second = createSurface(otherDocument);
			const third = createSurface(otherDocument);
			syncMathStylesToShadowRoot(first.root);
			syncMathStylesToShadowRoot(second.root);
			syncMathStylesToShadowRoot(third.root);
			expect(createSheet).toHaveBeenCalled();
			expect(second.root.adoptedStyleSheets[0]).toBeInstanceOf(otherSheet);
			expect(second.root.adoptedStyleSheets[0]).not.toBe(
				first.root.adoptedStyleSheets[0],
			);
			expect(second.root.adoptedStyleSheets[0]).toBe(
				third.root.adoptedStyleSheets[0],
			);
			iframe.remove();
		});

		test("disposal removes only its own sheet and allows the surface to be reused", () => {
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

		test("does not patch MathJax or schedule global CSS synchronization", () => {
			const updateDocument = vi.fn();
			const mathJax = { startup: { document: { updateDocument } } };
			(globalThis as { MathJax?: unknown }).MathJax = mathJax;
			const microtask = vi.spyOn(globalThis, "queueMicrotask");
			registerMathShadowRoot(createSurface().root);
			installMathShadowPatch();
			queueMathShadowStylesSync();
			expect(mathJax.startup.document.updateDocument).toBe(updateDocument);
			expect(microtask).not.toHaveBeenCalled();
		});

		test("does not touch unregistered shadow roots or light DOM", () => {
			const { root, host } = createSurface();
			const math = document.createElementNS(
				"http://www.w3.org/1998/Math/MathML",
				"math",
			);
			root.append(math);
			expect(syncMathStylesForNode(math)).toBe(false);
			expect(syncMathStylesForNode(host)).toBe(false);
			expect(syncMathStylesForNode(null)).toBe(false);
			expect(root.adoptedStyleSheets).toHaveLength(0);
		});

		test("reports unavailable adoption without claiming styles were installed", () => {
			const { root } = createSurface();
			Reflect.deleteProperty(root, "adoptedStyleSheets");
			expect(syncMathStylesToShadowRoot(root)).toBe(false);
			expect(() => unregisterMathShadowRoot(root)).not.toThrow();
		});
	});
});
