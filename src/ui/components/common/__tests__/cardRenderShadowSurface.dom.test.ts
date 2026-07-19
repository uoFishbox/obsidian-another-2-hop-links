import { describe, expect, it } from "vitest";
import { syncMathJaxStylesForNode } from "ui/shared/dom/mathJaxShadowStyles";
import { installVirtualListShadowSurface } from "ui/virtualization/svelte/VirtualSurfaceRuntime";
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
		).toContain(".view-plan-virtual-list-content");

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

		expect(syncMathJaxStylesForNode(mathEl)).toBe(false);
		expect(chtmlStylesheet).not.toHaveBeenCalled();

		sourceStyle.remove();
		host.remove();
	});

	it("mounts virtual list content directly into the surface element", () => {
		const host = document.createElement("div");
		const content = document.createElement("div");

		const handles = installVirtualListShadowSurface(host, content);

		expect(content.parentElement).toBe(handles.surfaceEl);
		expect(handles.surfaceEl.children).toHaveLength(1);
		expect(handles.surfaceEl.firstElementChild).toBe(content);

		handles.dispose();
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
