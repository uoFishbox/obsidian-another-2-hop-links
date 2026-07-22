import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	installResizeObserverMock,
	setNumericProperty,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import { createInlineSurfaceLayoutController } from "../inlineSurfaceLayoutController";

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
