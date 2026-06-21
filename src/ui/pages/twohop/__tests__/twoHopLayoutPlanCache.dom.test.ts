import { afterEach, describe, expect, it, vi } from "vitest";
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
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reuses only the exact descriptor, pagination, and layout inputs", () => {
		const cache = createTwoHopLayoutPlanCache({
			materialization: { kind: "eager" },
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) =>
				Math.min(section.loadedCount, count),
		});
		const sections = [descriptor];
		const visibleCounts = { "new-links": 1 };
		const first = cache.resolve(sections, visibleCounts, layout);

		expect(cache.resolve(sections, visibleCounts, layout)).toBe(first);
		expect(cache.resolve([...sections], visibleCounts, layout)).not.toBe(first);
		expect(cache.resolve(sections, { ...visibleCounts }, layout)).not.toBe(
			first,
		);
		expect(cache.resolve(sections, visibleCounts, { ...layout })).not.toBe(
			first,
		);
		expect(first.revision).toEqual({ kind: "opaque", token: first.plan });
	});

	it("cancels the previous deferred materialization task", () => {
		let nextIdleCallbackId = 1;
		const idleCallbacks = new Map<number, IdleRequestCallback>();
		const requestIdleCallback = vi
			.spyOn(window, "requestIdleCallback")
			.mockImplementation((callback) => {
				const id = nextIdleCallbackId++;
				idleCallbacks.set(id, callback);
				return id;
			});
		const cancelIdleCallback = vi
			.spyOn(window, "cancelIdleCallback")
			.mockImplementation((id) => {
				idleCallbacks.delete(id);
			});
		const cache = createTwoHopLayoutPlanCache({
			materialization: {
				kind: "batched",
				initialSectionCount: 0,
				initialCellCount: 0,
			},
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) =>
				Math.min(section.loadedCount, count),
		});
		const sections = [descriptor];
		const first = cache.resolve(sections, {}, layout);
		cache.scheduleMaterialization(first, vi.fn());
		const firstCallbackId = nextIdleCallbackId - 1;
		expect(idleCallbacks.has(firstCallbackId)).toBe(true);

		const second = cache.resolve([...sections], {}, layout);
		expect(cancelIdleCallback).toHaveBeenCalledWith(firstCallbackId);
		expect(idleCallbacks.has(firstCallbackId)).toBe(false);

		cache.scheduleMaterialization(second, vi.fn());
		const secondCallbackId = nextIdleCallbackId - 1;

		expect(idleCallbacks.has(secondCallbackId)).toBe(true);
		expect(requestIdleCallback).toHaveBeenCalledTimes(2);
	});
});
