import { describe, expect, it } from "vitest";
import type { TwoHopSectionDescriptor } from "../twohopPageVirtualModel";
import { createTwoHopLayoutPlanCache } from "../twoHopLayoutPlanCache";

const layout = {
	containerWidth: 320,
	columns: 2,
	cellWidth: 140,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 20,
};

const descriptor: TwoHopSectionDescriptor = {
	section: {
		kind: "new-links-section",
		rawSectionId: "new-links",
		sectionId: "new-links",
		sectionKey: "new-links",
		title: "New links",
		getKey: () => "",
	},
	sectionKey: "new-links",
	title: "New links",
	sectionId: "new-links",
	totalCount: 1,
	loadedCount: 1,
	getItems: () => [
		{
			kind: "new-link",
			item: { type: "link" } as never,
			searchKey: "item-0",
			virtualKey: "item-0",
		},
	],
	headerProps: {},
};

describe("createTwoHopLayoutPlanCache in a DOM runtime", () => {
	it("reuses only the exact descriptor, pagination, and layout inputs", () => {
		const cache = createTwoHopLayoutPlanCache({
			materialization: { kind: "eager" },
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const sections = [descriptor];
		const visibleCounts = { "new-links": 1 };
		const first = cache.resolve(sections, visibleCounts, layout);

		expect(cache.resolve(sections, visibleCounts, layout)).toBe(first);
		expect(cache.resolve([...sections], visibleCounts, layout)).not.toBe(first);
		expect(cache.resolve(sections, { ...visibleCounts }, layout)).not.toBe(first);
		expect(cache.resolve(sections, visibleCounts, { ...layout })).not.toBe(first);
		expect(first.revision).toEqual({ kind: "opaque", token: first.plan });
	});
});
