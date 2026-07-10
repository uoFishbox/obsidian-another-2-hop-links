import { describe, expect, it, vi } from "vitest";
import { scrollElementIntoVirtualViewport } from "../VirtualSurfaceNavigation";
import { flushVirtualScrollMeasurement } from "../../dom/flushVirtualScrollMeasurement";
import { createVirtualListMeasurementState } from "../../dom/virtualListMeasurementState";

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

	it("does not read layout after writing scrollTop", () => {
		const operations: string[] = [];
		const container = document.createElement("div");
		const root = document.createElement("div");
		container.append(root);
		let scrollTop = 0;
		Object.defineProperty(container, "clientHeight", {
			configurable: true,
			get: () => {
				operations.push("read-client-height");
				return 100;
			},
		});
		Object.defineProperty(container, "scrollTop", {
			configurable: true,
			get: () => {
				operations.push("read-scroll-top");
				return scrollTop;
			},
			set: (value: number) => {
				operations.push("write-scroll-top");
				scrollTop = value;
			},
		});
		container.getBoundingClientRect = () => {
			operations.push("read-scroller-rect");
			return {
				top: 0,
				left: 0,
				right: 300,
				bottom: 100,
				width: 300,
				height: 100,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			} as DOMRect;
		};
		root.getBoundingClientRect = () => {
			operations.push("read-root-rect");
			return {
				top: 0,
				left: 0,
				right: 300,
				bottom: 1000,
				width: 300,
				height: 1000,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			} as DOMRect;
		};
		const measurement = createVirtualListMeasurementState();
		const updateFromCachedMeasurement = vi.fn(() => {
			operations.push("commit-measurement");
		});

		const snapshot = scrollElementIntoVirtualViewport({
			rootEl: root,
			scrollContainerEl: container,
			targetTop: 180,
			targetHeight: 20,
		});
		flushVirtualScrollMeasurement({
			measurement,
			snapshot,
			updateFromCachedMeasurement,
		});

		expect(operations).toEqual([
			"read-root-rect",
			"read-scroll-top",
			"read-client-height",
			"read-scroller-rect",
			"write-scroll-top",
			"commit-measurement",
		]);
		expect(updateFromCachedMeasurement).toHaveBeenCalledWith(
			expect.objectContaining({
				scrollTop: 100,
				viewportHeight: 100,
			}),
		);
		expect(measurement.sectionTop).toBe(0);
		expect(measurement.viewportHeight).toBe(100);
	});
});
