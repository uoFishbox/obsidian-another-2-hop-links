import { describe, expect, it, vi } from "vitest";
import { restoreTwoHopLayoutAnchor, type TwoHopLayoutAnchor } from "../layoutAnchor";
import { createTwoHopRowModel, DEFAULT_TWO_HOP_GRID_LAYOUT } from "../rowModel";
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
