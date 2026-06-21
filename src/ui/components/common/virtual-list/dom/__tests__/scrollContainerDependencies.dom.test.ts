import { describe, expect, it } from "vitest";
import {
	collectPositionDependencyElements,
	collectStructureDependencyTargets,
} from "../scrollContainerDependencies";

describe("scrollContainerDependencies", () => {
	it("collects inline host sizer as a position dependency", () => {
		const scrollContainer = document.createElement("div");
		const sizer = document.createElement("div");
		const rootEl = document.createElement("div");

		scrollContainer.classList.add("cm-scroller", "ccl-inline-card-host");
		sizer.classList.add("cm-sizer");
		scrollContainer.append(sizer);
		sizer.append(rootEl);
		document.body.append(scrollContainer);

		expect(
			collectPositionDependencyElements(rootEl, scrollContainer),
		).toEqual([sizer]);
	});

	it("collects parent, shadow root, and scroll container structure dependencies", () => {
		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });
		const rootEl = document.createElement("div");
		const scrollContainer = document.createElement("div");

		document.body.append(host, scrollContainer);
		shadowRoot.append(rootEl);

		expect(
			collectStructureDependencyTargets(rootEl, scrollContainer),
		).toEqual([shadowRoot, scrollContainer]);
	});
});
