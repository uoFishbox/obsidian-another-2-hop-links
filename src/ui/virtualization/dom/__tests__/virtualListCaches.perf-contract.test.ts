import { afterEach, describe, expect, it, vi } from "vitest";
import {
	findNearestScrollContainerCached,
	invalidateNearestScrollContainerCache,
} from "../scrollContainer";

describe("virtual-list cache performance contracts", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("avoids repeated style reads while the nearest scroller cache is valid", () => {
		const scrollContainer = document.createElement("div");
		const root = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		scrollContainer.append(root);
		document.body.append(scrollContainer);
		const getComputedStyle = vi.spyOn(window, "getComputedStyle");

		expect(findNearestScrollContainerCached(root)).toBe(scrollContainer);
		const readsAfterMiss = getComputedStyle.mock.calls.length;
		expect(readsAfterMiss).toBeGreaterThan(0);

		expect(findNearestScrollContainerCached(root)).toBe(scrollContainer);
		expect(getComputedStyle).toHaveBeenCalledTimes(readsAfterMiss);

		invalidateNearestScrollContainerCache(root);
		expect(findNearestScrollContainerCached(root)).toBe(scrollContainer);
		expect(getComputedStyle.mock.calls.length).toBeGreaterThan(readsAfterMiss);
	});

	it("does not reuse a cached null result after a scrollable ancestor is attached", () => {
		const wrapper = document.createElement("div");
		const root = document.createElement("div");
		wrapper.append(root);
		document.body.append(wrapper);

		expect(findNearestScrollContainerCached(root)).toBeNull();

		const scrollContainer = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		Object.defineProperty(scrollContainer, "scrollHeight", {
			configurable: true,
			value: 1000,
		});
		Object.defineProperty(scrollContainer, "clientHeight", {
			configurable: true,
			value: 500,
		});
		document.body.append(scrollContainer);
		scrollContainer.append(wrapper);

		// The root keeps the same direct parent and document root. The cache must
		// still retry a previous negative lookup because higher ancestors changed.
		expect(findNearestScrollContainerCached(root)).toBe(scrollContainer);
	});

	it("finds a scroll container in another document realm", () => {
		const iframe = document.createElement("iframe");
		document.body.append(iframe);
		const iframeWindow = iframe.contentWindow;
		const iframeDocument = iframe.contentDocument;
		expect(iframeWindow).not.toBeNull();
		expect(iframeDocument).not.toBeNull();
		if (!iframeWindow || !iframeDocument) return;

		const scrollContainer = iframeDocument.createElement("div");
		const root = iframeDocument.createElement("div");
		scrollContainer.style.overflow = "auto";
		scrollContainer.append(root);
		iframeDocument.body.append(scrollContainer);
		const mainGetComputedStyle = vi.spyOn(window, "getComputedStyle");
		const iframeGetComputedStyle = vi.spyOn(iframeWindow, "getComputedStyle");

		expect(findNearestScrollContainerCached(root)).toBe(scrollContainer);
		expect(iframeGetComputedStyle).toHaveBeenCalled();
		expect(mainGetComputedStyle).not.toHaveBeenCalled();
	});
});
