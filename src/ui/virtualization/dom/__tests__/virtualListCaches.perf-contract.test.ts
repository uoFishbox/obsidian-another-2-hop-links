import { afterEach, describe, expect, it, vi } from "vitest";
import {
	findNearestScrollContainerCached,
	invalidateNearestScrollContainerCache,
} from "../scrollContainer";
import {
	resolveCachedCardGridLayoutBase,
	type CachedCardGridLayoutBase,
} from "../virtualListCardLayout";
import type { ResolvedCardLayoutSettings } from "ui/shared/layout/cardLayoutCssVars";

const defaults: ResolvedCardLayoutSettings = {
	cardWidthPx: 160,
	cardHeightRatio: 0.75,
	cardHeightPx: 120,
	cardGapPx: 12,
	cardMaxColumns: 4,
	sectionMarginBottomPx: 24,
};

const makeRect = (width: number): DOMRect =>
	({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: width,
		bottom: 0,
		width,
		height: 0,
		toJSON: () => ({}),
	}) as DOMRect;

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

	it("reuses one derived grid layout across repeated measurements for one list", () => {
		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.append(rootEl);
		document.body.append(scrollContainer);

		const layouts = Array.from({ length: 32 }, () =>
			resolveCachedCardGridLayoutBase({
				rootEl,
				rootRect: makeRect(640),
				measuredWidth: null,
				defaults,
				listKind: "flat",
				scrollContainerEl: scrollContainer,
				configuredLayout: defaults,
			}),
		);

		expect(new Set(layouts).size).toBe(1);
	});

	it("evicts the oldest derived grid layout after 48 entries", () => {
		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.append(rootEl);
		document.body.append(scrollContainer);
		const layouts: CachedCardGridLayoutBase[] = [];

		for (let width = 200; width < 249; width += 1) {
			layouts.push(
				resolveCachedCardGridLayoutBase({
					rootEl,
					rootRect: makeRect(width),
					measuredWidth: null,
					defaults,
					listKind: "flat",
					scrollContainerEl: scrollContainer,
					configuredLayout: defaults,
				}),
			);
		}

		const firstAfterEviction = resolveCachedCardGridLayoutBase({
			rootEl,
			rootRect: makeRect(200),
			measuredWidth: null,
			defaults,
			listKind: "flat",
			scrollContainerEl: scrollContainer,
			configuredLayout: defaults,
		});

		expect(firstAfterEviction).not.toBe(layouts[0]);
	});
});
