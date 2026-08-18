import { describe, expect, it } from "vitest";
import {
	computeContainerWidth,
	resolveCardGridLayoutBase,
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

	it("computes grid layout from CSS variables and measured width", () => {
		const root = document.createElement("div");
		root.style.setProperty("--ccl-box-size", "200px");
		root.style.setProperty("--ccl-box-height-ratio", "0.5");
		root.style.setProperty("--ccl-box-gap", "16px");
		root.style.setProperty("--ccl-box-cols-max", "3");
		document.body.append(root);

		const layout = resolveCardGridLayoutBase({
			rootEl: root,
			rootRect: makeRect(640),
			measuredWidth: null,
			defaults,
		});

		expect(layout).toMatchObject({
			containerWidth: 640,
			columns: 3,
			gap: 16,
			rowHeight: 101,
		});
	});
});
