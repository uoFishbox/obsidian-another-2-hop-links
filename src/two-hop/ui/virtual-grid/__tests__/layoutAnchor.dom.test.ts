import { describe, expect, it, vi } from "vitest";
import {
	restoreTwoHopLayoutAnchor,
	restoreTwoHopScrollPosition,
	type TwoHopLayoutAnchor,
} from "../anchorRestoration";
import { DEFAULT_TWO_HOP_GRID_LAYOUT } from "../layout";
import { createTwoHopRowModel } from "../rowModel";
import { createTwoHopSectionModel } from "two-hop/ui/twoHopSectionModel";

function createFixture() {
	const scroller = document.createElement("div");
	scroller.style.overflow = "auto";
	const root = scroller.appendChild(document.createElement("div"));
	const rowModel = createTwoHopRowModel({
		sections: [
			createTwoHopSectionModel({
				id: "section",
				kind: "new-links-section",
				title: "Section",
				items: [],
				totalCount: 0,
			}),
		],
		layout: DEFAULT_TWO_HOP_GRID_LAYOUT,
	});
	const cell = rowModel.getRow(0)!.getCell(0)!;
	let scrollTop = 950;
	Object.defineProperty(scroller, "scrollTop", {
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = Math.max(0, Math.min(1000, value));
		},
	});
	const anchor: TwoHopLayoutAnchor = {
		logicalKey: cell.logicalKey,
		rowTop: -200,
		scrollTop: 950,
		scrollRoot: scroller,
	};
	return { scroller, root, rowModel, anchor };
}

describe("two-hop layout anchor restoration", () => {
	it("returns the actual movement when the scroll limit clamps the target", () => {
		const { scroller, root, rowModel, anchor } = createFixture();
		expect(restoreTwoHopLayoutAnchor(anchor, root, rowModel)).toBe(50);
		expect(scroller.scrollTop).toBe(1000);
	});

	it("does not override scrolling that happened after capture", () => {
		const { scroller, root, rowModel, anchor } = createFixture();
		scroller.scrollTop = 900;
		expect(restoreTwoHopLayoutAnchor(anchor, root, rowModel)).toBe(0);
		expect(scroller.scrollTop).toBe(900);
	});

	it("does not restore after moving to another scroller or removing the anchor", () => {
		const { root, rowModel, anchor } = createFixture();
		const otherScroller = document.createElement("div");
		otherScroller.style.overflow = "auto";
		otherScroller.append(root);
		expect(restoreTwoHopLayoutAnchor(anchor, root, rowModel)).toBe(0);
		anchor.scrollRoot!.append(root);
		vi.spyOn(rowModel, "resolveCellPosition").mockReturnValue(null);
		expect(restoreTwoHopLayoutAnchor(anchor, root, rowModel)).toBe(0);
	});
});

describe("two-hop absolute scroll restoration", () => {
	it("restores the captured parent scrollTop after an intermediate clamp", () => {
		const scroller = document.createElement("div");
		const root = document.createElement("div");
		scroller.style.overflow = "auto";
		scroller.append(root);
		document.body.append(scroller);
		let scrollTop = 600;
		Object.defineProperty(scroller, "scrollTop", {
			configurable: true,
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value;
			},
		});
		scrollTop = 250;

		const restoration = restoreTwoHopScrollPosition(
			{ scrollRoot: scroller, scrollTop: 600 },
			root,
		);

		expect(restoration).toEqual({ delta: 350, scrollTop: 600 });
		expect(scroller.scrollTop).toBe(600);
	});
});
