import { afterEach, describe, expect, it, vi } from "vitest";
import { getScrollMetrics, readScrollSnapshot } from "../virtualListMeasurementAdapter";
import { setElementRect, setNumericProperty } from "testing/helpers/DOMObserverMock";

afterEach(() => {
	document.body.innerHTML = "";
});

describe("readScrollSnapshot", () => {
	it("writes element scroll state into a reusable output object", () => {
		const scrollContainer = document.createElement("div");
		const out = {
			scrollTop: -1,
			viewportHeight: -1,
		};

		setNumericProperty(scrollContainer, "scrollTop", 120);
		const clientHeightSpy = vi.fn(() => 180);
		Object.defineProperty(scrollContainer, "clientHeight", {
			configurable: true,
			get: clientHeightSpy,
		});

		const result = readScrollSnapshot(scrollContainer, 180, out);

		expect(result).toBe(out);
		expect(out).toEqual({
			scrollTop: 120,
			viewportHeight: 180,
		});
		expect(clientHeightSpy).not.toHaveBeenCalled();
	});

	it("writes window scroll state into a reusable output object", () => {
		const out = {
			scrollTop: -1,
			viewportHeight: -1,
		};

		setNumericProperty(window, "scrollY", 96);
		setNumericProperty(window, "innerHeight", 720);

		const result = readScrollSnapshot(null, undefined, out);

		expect(result).toBe(out);
		expect(out).toEqual({
			scrollTop: 96,
			viewportHeight: 720,
		});
	});

	it("writes owner-window scroll state for another document realm", () => {
		const iframe = document.createElement("iframe");
		document.body.append(iframe);
		const iframeWindow = iframe.contentWindow;
		const iframeDocument = iframe.contentDocument;
		expect(iframeWindow).not.toBeNull();
		expect(iframeDocument).not.toBeNull();
		if (!iframeWindow || !iframeDocument) return;

		const rootEl = iframeDocument.createElement("div");
		const out = {
			scrollTop: -1,
			viewportHeight: -1,
		};
		iframeDocument.body.append(rootEl);
		setNumericProperty(window, "scrollY", 11);
		setNumericProperty(window, "innerHeight", 22);
		setNumericProperty(iframeWindow, "scrollY", 96);
		setNumericProperty(iframeWindow, "innerHeight", 720);

		const result = readScrollSnapshot(null, undefined, out, rootEl);

		expect(result).toBe(out);
		expect(out).toEqual({
			scrollTop: 96,
			viewportHeight: 720,
		});
	});
});

describe("getScrollMetrics", () => {
	it("resolves section top relative to an element scroll container", () => {
		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);
		setNumericProperty(scrollContainer, "scrollTop", 80);
		setNumericProperty(scrollContainer, "clientHeight", 240);
		setElementRect(scrollContainer, {
			top: 20,
			width: 300,
			height: 240,
		});
		setElementRect(rootEl, {
			top: 70,
			width: 300,
			height: 400,
		});

		expect(getScrollMetrics(rootEl, scrollContainer)).toMatchObject({
			scrollTop: 80,
			viewportHeight: 240,
			sectionTop: 130,
		});
	});

	it("resolves section top relative to the window viewport", () => {
		const rootEl = document.createElement("div");
		document.body.append(rootEl);
		setNumericProperty(window, "scrollY", 120);
		setNumericProperty(window, "innerHeight", 720);
		setElementRect(rootEl, {
			top: 40,
			width: 300,
			height: 400,
		});

		expect(getScrollMetrics(rootEl, null)).toMatchObject({
			scrollTop: 120,
			viewportHeight: 720,
			sectionTop: 160,
		});
	});
});
