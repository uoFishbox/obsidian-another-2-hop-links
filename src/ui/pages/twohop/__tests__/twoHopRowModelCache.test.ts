import { describe, expect, it } from "vitest";
import type { TwoHopVirtualSectionDescriptor } from "../twoHopVirtualListModel";
import { createTwoHopRowModelCache } from "../twoHopRowModelCache";

const layout = {
	containerWidth: 320,
	columns: 2,
	cellWidth: 140,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 20,
};

const descriptor: TwoHopVirtualSectionDescriptor = {
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

describe("createTwoHopRowModelCache in a DOM runtime", () => {
	it("reuses semantically matching layout inputs without replacing the plan layout", () => {
		const cache = createTwoHopRowModelCache({
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const sections = [descriptor];
		const visibleCounts = { "new-links": 1 };
		const first = cache.resolve(sections, visibleCounts, layout);
		const equivalentLayout = { ...layout };

		expect(cache.resolve(sections, visibleCounts, layout)).toBe(first);
		expect(cache.resolve(sections, visibleCounts, equivalentLayout)).toBe(first);
		expect(first.plan.layout).toBe(layout);
		expect(first.plan.layout).not.toBe(equivalentLayout);
		expect(first.revision).toEqual({ kind: "opaque", token: first.plan });
	});

	it("reuses semantically matching pagination inputs", () => {
		const cache = createTwoHopRowModelCache({
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const sections = [descriptor];
		const visibleCounts = { "new-links": 1 };
		const first = cache.resolve(sections, visibleCounts, layout);

		expect(cache.resolve(sections, { ...visibleCounts }, layout)).toBe(first);
	});

	it("misses when descriptor or pagination values change", () => {
		const cache = createTwoHopRowModelCache({
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const sections = [descriptor];
		const visibleCounts = { "new-links": 1 };
		const first = cache.resolve(sections, visibleCounts, layout);

		expect(cache.resolve([...sections], visibleCounts, layout)).not.toBe(first);

		const cacheForVisibleCounts = createTwoHopRowModelCache({
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const firstForVisibleCounts = cacheForVisibleCounts.resolve(
			sections,
			visibleCounts,
			layout,
		);

		expect(
			cacheForVisibleCounts.resolve(sections, { "new-links": 0 }, layout),
		).not.toBe(firstForVisibleCounts);
	});

	it("misses when layout values change", () => {
		const cache = createTwoHopRowModelCache({
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const sections = [descriptor];
		const visibleCounts = { "new-links": 1 };
		const first = cache.resolve(sections, visibleCounts, layout);

		expect(
			cache.resolve(sections, visibleCounts, {
				...layout,
				columns: layout.columns + 1,
			}),
		).not.toBe(first);
	});
});
