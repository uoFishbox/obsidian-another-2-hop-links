import { afterEach, describe, expect, it, vi } from "vitest";
import {
	markScrollActivityActive,
	resetScrollActivityForTests,
} from "infrastructure/scroll/scrollActivity";
import type { TwoHopVirtualSectionDescriptor } from "../twoHopVirtualListModel";
import type { TwoHopCellStore } from "../twoHopViewPlan";
import { createTwoHopRowModelCache } from "../twoHopRowModelCache";
import { createTwoHopMaterializationScheduler } from "../twoHopMaterializationScheduler";

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

const readMaterializationState = (
	cellStore: TwoHopCellStore,
	sectionIndex: number,
) => ({
	nextCellIndex: cellStore.nextCellIndexBySection[sectionIndex],
	materializedCellCount:
		cellStore.materializedCellCountBySection[sectionIndex],
});

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

function createDeferredRowModel() {
	const materialization = createBatchedMaterialization(1);
	const cache = createTwoHopRowModelCache({
		materialization,
		resolveInitialSectionVisibleCount: (section) => section.loadedCount,
		clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
	});
	return {
		materialization,
		rowModel: cache.resolve([descriptor], {}, layout),
	};
}

const idleDeadline = {
	didTimeout: false,
	timeRemaining: () => 50,
} satisfies IdleDeadline;

describe("createTwoHopMaterializationScheduler in a DOM runtime", () => {
	afterEach(() => {
		resetScrollActivityForTests();
		vi.restoreAllMocks();
	});

	it("cancels the previous deferred materialization task", () => {
		const idle = installIdleCallbackHarness();
		const first = createDeferredRowModel();
		const second = createDeferredRowModel();
		const scheduler = createTwoHopMaterializationScheduler({
			materialization: first.materialization,
		});

		scheduler.schedule(first.rowModel, vi.fn());
		const firstCallbackId = idle.latestCallbackId;
		expect(idle.idleCallbacks.has(firstCallbackId)).toBe(true);

		scheduler.schedule(second.rowModel, vi.fn());
		const secondCallbackId = idle.latestCallbackId;

		expect(idle.cancelIdleCallback).toHaveBeenCalledWith(firstCallbackId);
		expect(idle.idleCallbacks.has(firstCallbackId)).toBe(false);
		expect(idle.idleCallbacks.has(secondCallbackId)).toBe(true);
		expect(idle.requestIdleCallback).toHaveBeenCalledTimes(2);
	});

	it("uses the background cell budget independently from the initial budget", () => {
		const idle = installIdleCallbackHarness();
		const onMaterialized = vi.fn();
		const { materialization, rowModel } = createDeferredRowModel();
		const scheduler = createTwoHopMaterializationScheduler({ materialization });

		expect(readMaterializationState(rowModel.plan.cellStore, 0)).toEqual({
			nextCellIndex: 0,
			materializedCellCount: 0,
		});

		scheduler.schedule(rowModel, onMaterialized);
		idle.idleCallbacks.get(idle.latestCallbackId)?.(idleDeadline);

		expect(readMaterializationState(rowModel.plan.cellStore, 0)).toEqual({
			nextCellIndex: 1,
			materializedCellCount: 1,
		});
		expect(onMaterialized).toHaveBeenCalledTimes(1);
	});

	it("does not run background materialization while scrolling", () => {
		const idle = installIdleCallbackHarness();
		const onMaterialized = vi.fn();
		const { materialization, rowModel } = createDeferredRowModel();
		const scheduler = createTwoHopMaterializationScheduler({ materialization });
		const scrollSource = {};

		scheduler.schedule(rowModel, onMaterialized);
		markScrollActivityActive(scrollSource);
		idle.idleCallbacks.get(idle.latestCallbackId)?.(idleDeadline);

		expect(rowModel.plan.cellStore.revision).toBe(0);
		expect(
			rowModel.plan.cellStore.materializedCellCountBySection[0],
		).toBe(0);
		expect(onMaterialized).not.toHaveBeenCalled();
		// No re-scheduled idle callback while scroll is active.
		expect(idle.requestIdleCallback).toHaveBeenCalledTimes(1);
	});

	it("resumes background materialization when scroll becomes idle", () => {
		const idle = installIdleCallbackHarness();
		const onMaterialized = vi.fn();
		const { materialization, rowModel } = createDeferredRowModel();
		const scheduler = createTwoHopMaterializationScheduler({ materialization });
		const scrollSource = {};

		scheduler.schedule(rowModel, onMaterialized);
		markScrollActivityActive(scrollSource);
		idle.idleCallbacks.get(idle.latestCallbackId)?.(idleDeadline);

		expect(onMaterialized).not.toHaveBeenCalled();

		// Scroll becomes idle; materialization should resume.
		resetScrollActivityForTests();
		idle.idleCallbacks.get(idle.latestCallbackId)?.(idleDeadline);

		expect(onMaterialized).toHaveBeenCalledTimes(1);
	});
});
