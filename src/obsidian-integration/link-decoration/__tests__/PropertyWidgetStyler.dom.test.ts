import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPropertyWidgetStyler } from "../propertyWidgetStyler";

function createWidget(): HTMLElement {
	const widget = document.createElement("div");
	const link = document.createElement("div");
	link.className = "internal-link";
	widget.appendChild(link);
	return widget;
}

describe("PropertyWidgetStyler.updateForPaths", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	afterEach(() => {
		document.body.innerHTML = "";
		vi.clearAllMocks();
	});

	it("updates only widgets whose source path is affected", () => {
		const stylingService = {
			decoratePropertiesPane: vi.fn(),
		};
		const styler = createPropertyWidgetStyler(stylingService as never);

		const matchedEl = createWidget();
		const otherEl = createWidget();
		document.body.appendChild(matchedEl);
		document.body.appendChild(otherEl);

		styler.register(matchedEl, { path: "notes/match.md" } as never);
		styler.register(otherEl, { path: "notes/other.md" } as never);

		styler.updateForPaths(["notes/match.md"]);

		expect(stylingService.decoratePropertiesPane).toHaveBeenCalledTimes(1);
		expect(stylingService.decoratePropertiesPane).toHaveBeenCalledWith(
			matchedEl,
			expect.objectContaining({ path: "notes/match.md" }),
		);
	});

	it("updates all connected widgets during a full refresh", () => {
		const stylingService = {
			decoratePropertiesPane: vi.fn(),
		};
		const styler = createPropertyWidgetStyler(stylingService as never);

		const firstEl = createWidget();
		const secondEl = createWidget();
		document.body.appendChild(firstEl);
		document.body.appendChild(secondEl);

		styler.register(firstEl, { path: "notes/first.md" } as never);
		styler.register(secondEl, { path: "notes/second.md" } as never);

		styler.updateAll();

		expect(stylingService.decoratePropertiesPane).toHaveBeenCalledTimes(2);
	});

	it("does not style disconnected widgets during targeted refresh", () => {
		const stylingService = {
			decoratePropertiesPane: vi.fn(),
		};
		const styler = createPropertyWidgetStyler(stylingService as never);

		const disconnectedEl = createWidget();
		styler.register(disconnectedEl, { path: "notes/match.md" } as never);

		styler.updateForPaths(["notes/match.md"]);

		expect(stylingService.decoratePropertiesPane).not.toHaveBeenCalled();
	});

	it("does not let a stale disconnected widget block styling of other widgets", () => {
		const stylingService = {
			decoratePropertiesPane: vi.fn(),
		};
		const styler = createPropertyWidgetStyler(stylingService as never);

		const staleEl = createWidget();
		const liveEl = createWidget();
		document.body.appendChild(liveEl);

		styler.register(staleEl, { path: "notes/stale.md" } as never);
		styler.register(liveEl, { path: "notes/live.md" } as never);

		styler.updateForPaths(["notes/stale.md", "notes/live.md"]);

		expect(stylingService.decoratePropertiesPane).toHaveBeenCalledTimes(1);
		expect(stylingService.decoratePropertiesPane).toHaveBeenCalledWith(
			liveEl,
			expect.objectContaining({ path: "notes/live.md" }),
		);
	});

	it("styles a widget after it is re-registered following reconnection", () => {
		const stylingService = {
			decoratePropertiesPane: vi.fn(),
		};
		const styler = createPropertyWidgetStyler(stylingService as never);

		const el = createWidget();
		styler.register(el, { path: "notes/reconnect.md" } as never);

		styler.updateForPaths(["notes/reconnect.md"]);
		expect(stylingService.decoratePropertiesPane).not.toHaveBeenCalled();

		document.body.appendChild(el);
		styler.register(el, { path: "notes/reconnect.md" } as never);

		stylingService.decoratePropertiesPane.mockClear();
		styler.updateForPaths(["notes/reconnect.md"]);

		expect(stylingService.decoratePropertiesPane).toHaveBeenCalledTimes(1);
		expect(stylingService.decoratePropertiesPane).toHaveBeenCalledWith(
			el,
			expect.objectContaining({ path: "notes/reconnect.md" }),
		);
	});
});
