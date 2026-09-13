import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installResizeObserverMock,
	setNumericProperty,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import {
	createInlineSurfaceLayoutController,
	refreshInlineSurfacePosition,
	INLINE_SURFACE_POSITION_CHANGED,
} from "../inlineSurfaceLayoutController";

describe("createInlineSurfaceLayoutController", () => {
	beforeEach(() => {
		installResizeObserverMock();
	});

	afterEach(() => {
		teardownResizeObserverMock();
		document.body.replaceChildren();
	});

	it("positions a source container at the direct sizer bottom", () => {
		const { container, sizer } = createSourceSurface();
		setNumericProperty(sizer, "offsetTop", 12.2);
		setNumericProperty(sizer, "offsetHeight", 100.1);

		const controller = createInlineSurfaceLayoutController({
			surface: "source",
			container,
		});

		expect(container.dataset.inlineSurfaceTop).toBe("113");
		expect(container.style.getPropertyValue("--ccl-inline-surface-top")).toBe(
			"113px",
		);
		controller.dispose();
	});

	it("updates only when the observed sizer bottom changes", () => {
		const { container, sizer } = createSourceSurface();
		setNumericProperty(sizer, "offsetTop", 5);
		setNumericProperty(sizer, "offsetHeight", 20);
		const controller = createInlineSurfaceLayoutController({
			surface: "source",
			container,
		});

		setNumericProperty(sizer, "offsetHeight", 42);
		triggerResize(sizer, 300, 42);

		expect(container.dataset.inlineSurfaceTop).toBe("47");
		expect(container.style.getPropertyValue("--ccl-inline-surface-top")).toBe(
			"47px",
		);

		controller.dispose();
		expect(container.dataset.inlineSurfaceTop).toBeUndefined();
		expect(container.style.getPropertyValue("--ccl-inline-surface-top")).toBe("");
	});

	it("does not position preview containers", () => {
		const container = document.createElement("div");
		document.body.append(container);

		const controller = createInlineSurfaceLayoutController({
			surface: "preview",
			container,
		});

		expect(container.dataset.inlineSurfaceTop).toBeUndefined();
		controller.dispose();
	});

	it("notifies after placement changes and silently refreshes missed changes before measurement", () => {
		const { container, sizer } = createSourceSurface();
		const scroller = container.parentElement!;
		const controller = createInlineSurfaceLayoutController({
			surface: "source",
			container,
		});
		const onPositionChanged = vi.fn(() => {
			expect(container.dataset.inlineSurfaceTop).toBe("240");
		});
		scroller.addEventListener(INLINE_SURFACE_POSITION_CHANGED, onPositionChanged);
		setNumericProperty(sizer, "offsetHeight", 240);
		triggerResize(sizer, 300, 200);
		triggerResize(sizer, 300, 200);
		expect(onPositionChanged).toHaveBeenCalledOnce();
		setNumericProperty(sizer, "offsetTop", 80);
		refreshInlineSurfacePosition(scroller);
		expect(container.dataset.inlineSurfaceTop).toBe("320");
		expect(onPositionChanged).toHaveBeenCalledOnce();
		controller.dispose();
		refreshInlineSurfacePosition(scroller);
		expect(container.dataset.inlineSurfaceTop).toBeUndefined();
	});
});

function createSourceSurface(): {
	container: HTMLElement;
	sizer: HTMLElement;
} {
	const scroller = document.createElement("div");
	const sizer = document.createElement("div");
	const container = document.createElement("div");
	scroller.className = "cm-scroller ccl-inline-card-host";
	sizer.className = "cm-sizer";
	container.className = "cosense-card-links__container";
	scroller.append(sizer, container);
	document.body.append(scroller);
	return { container, sizer };
}
