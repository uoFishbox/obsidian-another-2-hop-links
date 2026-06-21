import { describe, expect, it } from "vitest";
import {
	computeContainerWidth,
	resolveCachedCardGridLayoutBase,
} from "../virtualListCardLayout";
import type { ResolvedCardLayoutSettings } from "ui/utils/cardLayoutCssVars";

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

describe("VirtualListCardLayout", () => {
	it("prefers measured width, then rect width, then client width, then minimum width", () => {
		const root = document.createElement("div");
		Object.defineProperty(root, "clientWidth", {
			configurable: true,
			value: 320,
		});

		expect(computeContainerWidth(480, makeRect(640), root, 160)).toBe(480);
		expect(computeContainerWidth(null, makeRect(640), root, 160)).toBe(640);
		expect(computeContainerWidth(null, makeRect(0), root, 160)).toBe(320);

		Object.defineProperty(root, "clientWidth", {
			configurable: true,
			value: 0,
		});
		expect(computeContainerWidth(null, makeRect(0), root, 160)).toBe(160);
	});

	it("shares computed grid layout by scroller, css signature, and list kind", () => {
		const scroller = document.createElement("div");
		const firstRoot = document.createElement("div");
		const secondRoot = document.createElement("div");
		for (const root of [firstRoot, secondRoot]) {
			root.style.setProperty("--ccl-box-size", "200px");
			root.style.setProperty("--ccl-box-height-ratio", "0.5");
			root.style.setProperty("--ccl-box-gap", "16px");
			root.style.setProperty("--ccl-box-cols-max", "3");
			root.style.setProperty("--ccl-section-margin-bottom", "32px");
			scroller.append(root);
		}
		document.body.append(scroller);

		const first = resolveCachedCardGridLayoutBase({
			rootEl: firstRoot,
			rootRect: makeRect(640),
			measuredWidth: null,
			defaults,
			listKind: "view-plan",
			scrollContainerEl: scroller,
		});
		const second = resolveCachedCardGridLayoutBase({
			rootEl: secondRoot,
			rootRect: makeRect(640),
			measuredWidth: null,
			defaults,
			listKind: "view-plan",
			scrollContainerEl: scroller,
		});

		expect(second).toBe(first);
		expect(first).toMatchObject({
			containerWidth: 640,
			columns: 3,
			gap: 16,
			rowHeight: 101,
		});

		scroller.remove();
	});

	it("keeps view-plan section margin changes out of shared cache hits", () => {
		const scroller = document.createElement("div");
		const firstRoot = document.createElement("div");
		const secondRoot = document.createElement("div");
		for (const root of [firstRoot, secondRoot]) {
			root.style.setProperty("--ccl-box-size", "200px");
			root.style.setProperty("--ccl-box-height-ratio", "0.5");
			root.style.setProperty("--ccl-box-gap", "16px");
			root.style.setProperty("--ccl-box-cols-max", "3");
			scroller.append(root);
		}
		firstRoot.style.setProperty("--ccl-section-margin-bottom", "32px");
		secondRoot.style.setProperty("--ccl-section-margin-bottom", "48px");
		document.body.append(scroller);

		const first = resolveCachedCardGridLayoutBase({
			rootEl: firstRoot,
			rootRect: makeRect(640),
			measuredWidth: null,
			defaults,
			listKind: "view-plan",
			scrollContainerEl: scroller,
		});
		const second = resolveCachedCardGridLayoutBase({
			rootEl: secondRoot,
			rootRect: makeRect(640),
			measuredWidth: null,
			defaults,
			listKind: "view-plan",
			scrollContainerEl: scroller,
		});

		expect(second).not.toBe(first);
		expect(first.cardLayout.sectionMarginBottomPx).toBe(32);
		expect(second.cardLayout.sectionMarginBottomPx).toBe(48);

		scroller.remove();
	});
});
