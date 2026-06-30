import { describe, expect, it } from "vitest";
import { findNearestScrollContainer } from "../scrollContainer";

describe("findNearestScrollContainer", () => {
	it("finds the nearest scroll container through regular ancestors", () => {
		const scrollContainer = document.createElement("div");
		scrollContainer.style.overflowY = "auto";
		const wrapper = document.createElement("div");
		const child = document.createElement("div");

		wrapper.append(child);
		scrollContainer.append(wrapper);
		document.body.append(scrollContainer);

		expect(findNearestScrollContainer(child)).toBe(scrollContainer);
	});

	it("crosses an open shadow root to reach the host ancestors", () => {
		const scrollContainer = document.createElement("div");
		scrollContainer.style.overflowY = "auto";
		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });
		const child = document.createElement("div");

		shadowRoot.append(child);
		scrollContainer.append(host);
		document.body.append(scrollContainer);

		expect(findNearestScrollContainer(child)).toBe(scrollContainer);
	});

	it("skips non-scrollable overflow wrappers when a scrollable ancestor exists", () => {
		const scrollContainer = document.createElement("div");
		scrollContainer.style.overflowY = "auto";
		Object.defineProperty(scrollContainer, "scrollHeight", { value: 200 });
		Object.defineProperty(scrollContainer, "clientHeight", { value: 100 });

		const wrapper = document.createElement("div");
		wrapper.style.overflowY = "auto";
		Object.defineProperty(wrapper, "scrollHeight", { value: 100 });
		Object.defineProperty(wrapper, "clientHeight", { value: 100 });

		const child = document.createElement("div");

		wrapper.append(child);
		scrollContainer.append(wrapper);
		document.body.append(scrollContainer);

		expect(findNearestScrollContainer(child)).toBe(scrollContainer);
	});
});
