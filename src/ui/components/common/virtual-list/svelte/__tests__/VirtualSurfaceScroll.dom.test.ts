import { describe, expect, it } from "vitest";
import { scrollElementIntoVirtualViewport } from "../VirtualSurfaceNavigation";

const setClientHeight = (element: HTMLElement, value: number): void => {
	Object.defineProperty(element, "clientHeight", {
		configurable: true,
		value,
	});
};

const setRect = (
	element: HTMLElement,
	rect: Pick<DOMRect, "top" | "width" | "height">,
): void => {
	element.getBoundingClientRect = () =>
		({
			top: rect.top,
			left: 0,
			right: rect.width,
			bottom: rect.top + rect.height,
			width: rect.width,
			height: rect.height,
			x: 0,
			y: rect.top,
			toJSON: () => ({}),
		}) as DOMRect;
};

describe("VirtualSurfaceScroll", () => {
	it("scrolls a container just enough to reveal a virtual target", () => {
		const container = document.createElement("div");
		const root = document.createElement("div");
		container.append(root);
		setClientHeight(container, 100);
		setRect(container, { top: 0, width: 300, height: 100 });
		setRect(root, { top: 0, width: 300, height: 1000 });

		scrollElementIntoVirtualViewport({
			rootEl: root,
			scrollContainerEl: container,
			targetTop: 180,
			targetHeight: 20,
		});

		expect(container.scrollTop).toBe(100);
	});
});
