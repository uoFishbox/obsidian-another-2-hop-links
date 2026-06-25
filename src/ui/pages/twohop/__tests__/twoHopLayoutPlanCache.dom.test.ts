import { afterEach, describe, expect, it, vi } from "vitest";
import {
	markScrollActivityActive,
	resetScrollActivityForTests,
} from "infrastructure/scroll/scrollActivity";
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

const createBatchedMaterialization = (backgroundCellCount: number) =>
	({
		kind: "batched",
		initial: {
			maxSectionCount: 0,
			maxCellCount: 0,
		},
		background: {
			maxCellCountPerSlice: backgroundCellCount,
		},
	}) as const;

function installIdleCallbackHarness() {
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

	return {
		idleCallbacks,
		requestIdleCallback,
		cancelIdleCallback,
		get latestCallbackId() {
			return nextIdleCallbackId - 1;
		},
	};
}

const idleDeadline = {
	didTimeout: false,
	timeRemaining: () => 50,
} satisfies IdleDeadline;

describe("createTwoHopLayoutPlanCache in a DOM runtime", () => {
	afterEach(() => {
		resetScrollActivityForTests();
		vi.restoreAllMocks();
	});

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

	it("cancels the previous deferred materialization task", () => {
		const idle = installIdleCallbackHarness();
		const cache = createTwoHopLayoutPlanCache({
			materialization: createBatchedMaterialization(1),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const sections = [descriptor];
		const first = cache.resolve(sections, {}, layout);
		cache.scheduleMaterialization(first, vi.fn());
		const firstCallbackId = idle.latestCallbackId;
		expect(idle.idleCallbacks.has(firstCallbackId)).toBe(true);

		const second = cache.resolve([...sections], {}, layout);
		expect(idle.cancelIdleCallback).toHaveBeenCalledWith(firstCallbackId);
		expect(idle.idleCallbacks.has(firstCallbackId)).toBe(false);

		cache.scheduleMaterialization(second, vi.fn());
		const secondCallbackId = idle.latestCallbackId;

		expect(idle.idleCallbacks.has(secondCallbackId)).toBe(true);
		expect(idle.requestIdleCallback).toHaveBeenCalledTimes(2);
	});

	it("uses the background cell budget independently from the initial budget", () => {
		const idle = installIdleCallbackHarness();
		const onMaterialized = vi.fn();
		const cache = createTwoHopLayoutPlanCache({
			materialization: createBatchedMaterialization(1),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const rowModel = cache.resolve([descriptor], {}, layout);

		expect(rowModel.plan.cellStore.materializationStateBySectionIndex[0]).toEqual({
			nextCellIndex: 0,
			materializedCellCount: 0,
		});

		cache.scheduleMaterialization(rowModel, onMaterialized);
		idle.idleCallbacks.get(idle.latestCallbackId)?.(idleDeadline);

		expect(rowModel.plan.cellStore.materializationStateBySectionIndex[0]).toEqual({
			nextCellIndex: 1,
			materializedCellCount: 1,
		});
		expect(onMaterialized).toHaveBeenCalledTimes(1);
	});

	it("does not run background materialization while scrolling", () => {
		const idle = installIdleCallbackHarness();
		const onMaterialized = vi.fn();
		const cache = createTwoHopLayoutPlanCache({
			materialization: createBatchedMaterialization(1),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const rowModel = cache.resolve([descriptor], {}, layout);
		const scrollSource = {};

		cache.scheduleMaterialization(rowModel, onMaterialized);
		markScrollActivityActive(scrollSource);
		idle.idleCallbacks.get(idle.latestCallbackId)?.(idleDeadline);

		expect(rowModel.plan.cellStore.revision).toBe(0);
		expect(
			rowModel.plan.cellStore.materializationStateBySectionIndex[0]?.materializedCellCount,
		).toBe(0);
		expect(onMaterialized).not.toHaveBeenCalled();
		// No re-scheduled idle callback while scroll is active.
		expect(idle.requestIdleCallback).toHaveBeenCalledTimes(1);
	});

	it("resumes background materialization when scroll becomes idle", () => {
		const idle = installIdleCallbackHarness();
		const onMaterialized = vi.fn();
		const cache = createTwoHopLayoutPlanCache({
			materialization: createBatchedMaterialization(1),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});
		const rowModel = cache.resolve([descriptor], {}, layout);
		const scrollSource = {};

		cache.scheduleMaterialization(rowModel, onMaterialized);
		markScrollActivityActive(scrollSource);
		idle.idleCallbacks.get(idle.latestCallbackId)?.(idleDeadline);

		expect(onMaterialized).not.toHaveBeenCalled();

		// Scroll becomes idle — materialization should resume.
		resetScrollActivityForTests();
		idle.idleCallbacks.get(idle.latestCallbackId)?.(idleDeadline);

		expect(onMaterialized).toHaveBeenCalledTimes(1);
	});
});
