import { describe, expect, it } from "vitest";
import { compileFixedGridLayout } from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	appendTwoHopProgressivePlan,
	compileTwoHopProgressivePlan,
	resolveInitialProgressiveMountedRowEnd,
	resolveNextProgressiveMountedRowEnd,
	TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
} from "features/two-hop/ui/twoHopProgressivePlan";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "features/two-hop/ui/twoHopSectionModel";

function createSections(count: number, visibleCount = count) {
	const items = Array.from({ length: visibleCount }, (_, index) => ({
		item: { type: "newLink" },
		searchKey: `item-${index}`,
		key: `item-${index}`,
	})) as TwoHopItemModel[];
	const section = createTwoHopSectionModel({
		id: "section",
		kind: "new-links-section",
		title: "Section",
		items,
		totalCount: count,
	});
	return [section];
}

const layout = {
	containerWidth: 100,
	columns: 1,
	cellWidth: 100,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 10,
};

describe("two-hop progressive plan", () => {
	it("builds header, item, and load-more cells directly from sections", () => {
		const sections = createSections(3, 2);
		const geometry = compileFixedGridLayout(sections, layout);
		const plan = compileTwoHopProgressivePlan(
			sections,
			geometry,
			geometry.rowCount,
		);
		const cells = plan.chunks.flatMap((chunk) =>
			chunk.rows.flatMap((row) => row.cells),
		);

		expect(cells.map((cell) => cell.kind)).toEqual([
			"header",
			"item",
			"item",
			"load-more",
		]);
		expect(cells[1]?.logicalKey).toBe("item:section:item-0");
	});

	it("appends in place without copying the chunk buffer", () => {
		const sections = createSections(TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK * 3);
		const geometry = compileFixedGridLayout(sections, layout);
		const initialEnd = resolveInitialProgressiveMountedRowEnd(geometry.rowCount);
		const first = compileTwoHopProgressivePlan(sections, geometry, initialEnd);
		const firstChunkCount = first.chunks.length;
		const nextEnd = resolveNextProgressiveMountedRowEnd(
			first.mountedRowEnd,
			geometry.rowCount,
		);
		const second = appendTwoHopProgressivePlan(sections, geometry, first, nextEnd);

		expect(second).not.toBe(first);
		expect(second.chunks).toBe(first.chunks);
		expect(second.chunks).toHaveLength(firstChunkCount + 1);
		expect(second.chunks[0]).toBe(first.chunks[0]);
		expect(second.mountedRowEnd).toBe(nextEnd);
	});
});
