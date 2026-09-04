import { afterEach, describe, expect, it, vi } from "vitest";
import { findNearestScrollContainer } from "../scrollContainer";

describe("findNearestScrollContainer", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

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

	it("reflects ancestor changes on the next lookup", () => {
		const wrapper = document.createElement("div");
		const child = document.createElement("div");
		wrapper.append(child);
		document.body.append(wrapper);

		expect(findNearestScrollContainer(child)).toBeNull();

		const scrollContainer = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000 });
		Object.defineProperty(scrollContainer, "clientHeight", { value: 500 });
		document.body.append(scrollContainer);
		scrollContainer.append(wrapper);

		expect(findNearestScrollContainer(child)).toBe(scrollContainer);
	});

	it("uses the element's document realm for style resolution", () => {
		const iframe = document.createElement("iframe");
		document.body.append(iframe);
		const iframeWindow = iframe.contentWindow;
		const iframeDocument = iframe.contentDocument;
		expect(iframeWindow).not.toBeNull();
		expect(iframeDocument).not.toBeNull();
		if (!iframeWindow || !iframeDocument) return;

		const scrollContainer = iframeDocument.createElement("div");
		const child = iframeDocument.createElement("div");
		scrollContainer.style.overflow = "auto";
		scrollContainer.append(child);
		iframeDocument.body.append(scrollContainer);
		const mainGetComputedStyle = vi.spyOn(window, "getComputedStyle");
		const iframeGetComputedStyle = vi.spyOn(iframeWindow, "getComputedStyle");

		expect(findNearestScrollContainer(child)).toBe(scrollContainer);
		expect(iframeGetComputedStyle).toHaveBeenCalled();
		expect(mainGetComputedStyle).not.toHaveBeenCalled();
	});
});
