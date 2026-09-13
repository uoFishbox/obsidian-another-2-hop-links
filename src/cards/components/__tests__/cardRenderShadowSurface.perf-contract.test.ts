import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import {
	resetMathShadowStylesStateForTests,
	syncMathStylesForNode,
} from "shared/ui/dom/mathShadowStyles";
import { ensureCardRenderShadowSurface } from "../cardRenderShadowSurface";
import { createShadowSurfaceFixture } from "./cardRenderShadowSurfaceTestHelpers";

// AGENTS.md and PERFORMANCE.md both require the Temml stylesheet to be parsed
// once per Document and adopted by every shadow root, rather than cloned into
// each surface. These contracts assert CSSStyleSheet identity and parse counts
// on purpose: a failure here means the sharing implementation changed, not that
// a card rendered incorrectly. Behavioural coverage lives in
// `cardRenderShadowSurface.dom.test.ts`.
describe("cardRenderShadowSurface shared stylesheet contracts", () => {
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

	it("parses the Temml stylesheet once and adopts the same object per Document", () => {
		const replace = vi.spyOn(CSSStyleSheet.prototype, "replaceSync");
		const first = createShadowSurfaceFixture();
		const second = createShadowSurfaceFixture();
		const firstSurface = ensureCardRenderShadowSurface(first.host);
		ensureCardRenderShadowSurface(second.host);
		// Re-entering a host that already has a surface must not parse again.
		ensureCardRenderShadowSurface(first.host);
		firstSurface.surfaceEl.innerHTML =
			'<div class="math-rendered"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></div>';

		expect(syncMathStylesForNode(firstSurface.surfaceEl)).toBe(true);
		expect(first.root.adoptedStyleSheets).toHaveLength(1);
		expect(first.root.adoptedStyleSheets[0]).toBe(
			second.root.adoptedStyleSheets[0],
		);
		expect(replace).toHaveBeenCalledTimes(1);

		// Temml ships its own fonts, so duplicating @font-face per surface would
		// multiply the font download.
		const css = Array.from(first.root.adoptedStyleSheets[0].cssRules)
			.map((rule) => rule.cssText)
			.join("\n");
		expect(css).toContain('"Latin Modern Math"');
		expect(css).not.toContain("@font-face");
		expect(css).not.toContain("public/fonts/");

		firstSurface.dispose();
	});

	it("disposal removes only its own sheet and allows the surface to be reused", () => {
		const { host, root } = createShadowSurfaceFixture();
		const otherSheet = new CSSStyleSheet();
		root.adoptedStyleSheets = [otherSheet];
		const handles = ensureCardRenderShadowSurface(host);
		const sharedSheet = root.adoptedStyleSheets[1];
		expect(root.adoptedStyleSheets).toHaveLength(2);

		// Disposal has to be idempotent and must not evict sheets it does not own.
		handles.dispose();
		handles.dispose();
		expect(root.adoptedStyleSheets).toEqual([otherSheet]);

		ensureCardRenderShadowSurface(host);
		expect(root.adoptedStyleSheets).toEqual([otherSheet, sharedSheet]);
	});
});
