import { beforeEach, describe, expect, test } from "vitest";
import {
	installMathJaxShadowPatch,
	queueMathJaxShadowStylesSync,
	registerMathJaxShadowRoot,
	unregisterMathJaxShadowRoot,
	resetMathJaxShadowStylesStateForTests,
	syncMathJaxStylesForNode,
	syncMathJaxStylesToShadowRoot,
} from "../mathJaxShadowStyles";

describe("mathJaxShadowStyles", () => {
	beforeEach(() => {
		resetMathJaxShadowStylesStateForTests();
		document.head.innerHTML = "";
		document.body.innerHTML = "";
		delete (globalThis as { MathJax?: unknown }).MathJax;
	});

	test("copies the current MathJax CHTML stylesheet into a shadow root", () => {
		const sourceStyle = document.createElement("style");
		sourceStyle.id = "MJX-CHTML-styles";
		sourceStyle.textContent = "mjx-container { color: red; }";
		document.head.append(sourceStyle);

		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });

		expect(syncMathJaxStylesToShadowRoot(shadowRoot)).toBe(true);

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
		registerMathJaxShadowRoot(shadowRoot);

		expect(syncMathJaxStylesForNode(mathEl)).toBe(true);
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
		registerMathJaxShadowRoot(shadowRoot);
		unregisterMathJaxShadowRoot(shadowRoot);

		expect(syncMathJaxStylesForNode(mathEl)).toBe(false);
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

		(globalThis as { MathJax?: unknown }).MathJax = {
			chtmlStylesheet,
			startup: {
				document: {
					updateDocument,
				},
			},
		};

		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });
		document.body.append(host);
		registerMathJaxShadowRoot(shadowRoot);
		syncMathJaxStylesToShadowRoot(shadowRoot);

		installMathJaxShadowPatch();
		(globalThis as { MathJax?: any }).MathJax.startup.document.updateDocument();
		queueMathJaxShadowStylesSync();
		await new Promise((resolve) => window.setTimeout(resolve, 20));

		const cloned = shadowRoot.querySelector<HTMLStyleElement>(
			"style[data-ccl-mathjax-shadow-style]",
		);
		expect(chtmlStylesheet).not.toHaveBeenCalled();
		expect(cloned?.textContent).toContain("mjx-c1D44E");
	});
});
