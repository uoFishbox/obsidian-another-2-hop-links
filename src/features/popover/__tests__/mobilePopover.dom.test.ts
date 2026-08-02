import { describe, expect, it, vi } from "vitest";
import { Platform, TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import {
	resolveHoverPopoverTargetElement,
	triggerHoverPopover,
} from "../mobilePopover";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
	return {
		...actual,
		Platform: {
			isMobile: false,
		},
		TFile: class {},
	};
});

describe("mobilePopover", () => {
	it("keeps the original target element when it is not rendered inside a shadow root", () => {
		const targetEl = document.createElement("div");
		document.body.append(targetEl);

		expect(resolveHoverPopoverTargetElement(targetEl)).toBe(targetEl);
	});

	it("creates a light DOM proxy target for elements rendered inside a shadow root", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });
		const targetEl = document.createElement("div");
		shadowRoot.append(targetEl);
		vi.spyOn(targetEl, "getBoundingClientRect").mockReturnValue({
			x: 12,
			y: 24,
			left: 12,
			top: 24,
			right: 212,
			bottom: 104,
			width: 200,
			height: 80,
			toJSON: () => ({}),
		} as DOMRect);

		const resolved = resolveHoverPopoverTargetElement(targetEl);

		expect(resolved).not.toBe(targetEl);
		expect(resolved?.parentElement).toBe(document.body);
		expect(resolved?.getRootNode()).toBe(document);
		expect(resolved?.getAttribute("data-ccl-shadow-hover-proxy")).toBe("1");
	});

	it("uses the light DOM proxy target when dispatching Obsidian hover-link from a shadow-root card", () => {
		Platform.isMobile = false;
		const workspace = {
			trigger: vi.fn(),
		} as any;
		const plugin = {
			app: {},
		} as any;
		const targetFile = createMockTFile("notes/target.md");
		const sourceFile = createMockTFile("notes/source.md");
		const host = document.createElement("div");
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });
		const cardEl = document.createElement("div");
		shadowRoot.append(cardEl);
		vi.spyOn(cardEl, "getBoundingClientRect").mockReturnValue({
			x: 40,
			y: 60,
			left: 40,
			top: 60,
			right: 260,
			bottom: 180,
			width: 220,
			height: 120,
			toJSON: () => ({}),
		} as DOMRect);

		const hoverEvent = new MouseEvent("mouseover", { bubbles: true });
		Object.defineProperty(hoverEvent, "currentTarget", {
			value: cardEl,
			configurable: true,
		});

		triggerHoverPopover(
			workspace,
			plugin,
			hoverEvent,
			{
				rawText: "target",
				path: targetFile.path,
				sourceFile,
				isUnresolved: false,
				position: undefined,
			},
			targetFile,
			{
				highlightInPreviewOnHover: true,
			} as any,
			false,
		);

		expect(workspace.trigger).toHaveBeenCalledTimes(1);
		const payload = vi.mocked(workspace.trigger).mock.calls[0]?.[1] as {
			targetEl: HTMLElement;
		};
		expect(payload.targetEl).not.toBe(cardEl);
		expect(payload.targetEl.parentElement).toBe(document.body);
		expect(payload.targetEl.getAttribute("data-ccl-shadow-hover-proxy")).toBe("1");
	});
});
