import { describe, expect, it } from "vitest";
import {
	compileFixedGridLayout,
	resolveSectionIndexForRow,
	resolveTwoHopRowFromScrollOffset,
	resolveTwoHopRowTop,
	resolveTwoHopVisibleWindowInto,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
	type TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";

const layout = {
	containerWidth: 220,
	columns: 2,
	cellWidth: 100,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 10,
};

function createItem(key: string): TwoHopItemModel {
	return {
		item: { type: "newLink" } as TwoHopItemModel["item"],
		searchKey: key,
		key,
	};
}

function createSection(
	id: string,
	count: number,
	visibleCount = count,
): TwoHopSectionModel {
	const section = createTwoHopSectionModel({
		id,
		kind: "new-links-section",
		title: id,
		items: Array.from({ length: count }, (_, index) =>
			createItem(`${id}-${index}`),
		),
	});
	return visibleCount === count
		? section
		: (Object.freeze({ ...section, visibleCount }) as TwoHopSectionModel);
}

describe("two-hop geometry", () => {
	it("compiles section prefixes including load-more cells", () => {
		const sections = [createSection("first", 4, 3), createSection("second", 1)];
		const geometry = compileFixedGridLayout(sections, layout);

		expect(geometry.firstRowBySection).toEqual(new Uint32Array([0, 3]));
		expect(geometry.rowCountBySection).toEqual(new Uint32Array([3, 1]));
		expect(geometry.topBySection).toEqual(new Float64Array([0, 330]));
		expect(geometry.rowCount).toBe(4);
		expect(resolveSectionIndexForRow(geometry, 3)).toBe(1);
		expect(resolveTwoHopRowTop(geometry, 3)).toBe(330);
	});

	it("resolves visible and anchor rows with binary section lookup", () => {
		const geometry = compileFixedGridLayout(
			[createSection("first", 2), createSection("second", 1)],
			layout,
		);
		const range = { start: 0, end: 0 };
		const stableBand = { min: 0, max: 0 };
		resolveTwoHopVisibleWindowInto(range, stableBand, geometry, 225, 120);

		expect(range).toEqual({ start: 2, end: 3 });
		expect(stableBand).toEqual({ min: 210, max: 320 });
		expect(resolveTwoHopRowFromScrollOffset(geometry, 0)).toBe(0);
		expect(resolveTwoHopRowFromScrollOffset(geometry, 225)).toBe(2);
		expect(
			resolveTwoHopRowFromScrollOffset(geometry, geometry.totalHeight),
		).toBeNull();
	});

	it("uses half-open visibility with fractional row metrics", () => {
		const geometry = compileFixedGridLayout([createSection("first", 2)], {
			...layout,
			columns: 1,
			rowHeight: 100.25,
			gap: 10.5,
			sectionMarginBottom: 0,
		});
		const range = { start: 0, end: 0 };
		const stableBand = { min: 0, max: 0 };
		resolveTwoHopVisibleWindowInto(range, stableBand, geometry, 100.25, 10.5);
		expect(range).toEqual({ start: 1, end: 1 });
		expect(stableBand.min).toBe(Number.POSITIVE_INFINITY);
		expect(stableBand.max).toBe(Number.NEGATIVE_INFINITY);

		resolveTwoHopVisibleWindowInto(range, stableBand, geometry, 100.25, 10.51);
		expect(range).toEqual({ start: 1, end: 2 });
		expect(stableBand).toEqual({ min: 100.25, max: 210.99 });
	});

	it("returns one-sided stable bands while the viewport is outside the content", () => {
		const geometry = compileFixedGridLayout([createSection("first", 2)], layout);
		const range = { start: 0, end: 0 };
		const stableBand = { min: 0, max: 0 };

		resolveTwoHopVisibleWindowInto(range, stableBand, geometry, -200, 100);
		expect(range).toEqual({ start: 0, end: 0 });
		expect(stableBand).toEqual({
			min: Number.NEGATIVE_INFINITY,
			max: -100,
		});

		resolveTwoHopVisibleWindowInto(
			range,
			stableBand,
			geometry,
			geometry.totalHeight,
			100,
		);
		expect(range).toEqual({ start: 0, end: 0 });
		expect(stableBand).toEqual({
			min: geometry.totalHeight,
			max: Number.POSITIVE_INFINITY,
		});
	});
});
