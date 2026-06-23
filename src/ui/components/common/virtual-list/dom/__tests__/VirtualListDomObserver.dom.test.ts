import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeVirtualListViewport } from "../virtualListDomObserver";
import { resetScrollActivityForTests } from "infrastructure/scroll/scrollActivity";
import {
	installMutationObserverMock,
	installResizeObserverMock,
	mutationObserverRecords,
	resetRecords,
	resizeObserverRecords,
	setElementRect,
	teardownMutationObserverMock,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";

describe("observeVirtualListViewport", () => {
	beforeEach(() => {
		resetRecords();
		installResizeObserverMock();
		installMutationObserverMock();
	});

	afterEach(() => {
		document.body.innerHTML = "";
		resetScrollActivityForTests();
		vi.useRealTimers();
		teardownResizeObserverMock();
		teardownMutationObserverMock();
	});

	it("keeps the root resize observation active", () => {
		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");

		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		setElementRect(rootEl, {
			top: 10,
			width: 200,
			height: 100,
		});
		setElementRect(scrollContainer, {
			top: 0,
			width: 240,
			height: 240,
		});

		const onWidthChange = vi.fn();
		const stopObserving = observeVirtualListViewport({
			rootEl,
			onWidthChange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement: vi.fn(),
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});

		triggerResize(rootEl, 320, 100);

		expect(onWidthChange).toHaveBeenCalledWith(320);

		stopObserving();
	});

	it("keeps only one active subscriber inside the same element scroller", () => {
		const scrollContainer = document.createElement("div");
		const firstRootEl = document.createElement("div");
		const secondRootEl = document.createElement("div");

		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(firstRootEl, secondRootEl);

		setElementRect(firstRootEl, {
			top: 10,
			width: 200,
			height: 100,
		});
		setElementRect(secondRootEl, {
			top: 120,
			width: 200,
			height: 100,
		});
		setElementRect(scrollContainer, {
			top: 0,
			width: 240,
			height: 240,
		});

		const firstStopObserving = observeVirtualListViewport({
			rootEl: firstRootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement: vi.fn(),
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});
		const secondStopObserving = observeVirtualListViewport({
			rootEl: secondRootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement: vi.fn(),
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});

		expect(mutationObserverRecords).toHaveLength(1);
		const rootResizeRecord = resizeObserverRecords.find((record) =>
			record.elements.has(secondRootEl),
		);
		expect(rootResizeRecord?.elements.has(firstRootEl)).toBe(false);

		firstStopObserving();
		expect(mutationObserverRecords[0].elements.size).toBeGreaterThan(0);

		secondStopObserving();
	});

	it("runs layout measurement on scroll idle only when layout was dirtied", async () => {
		vi.useFakeTimers();

		const scrollContainer = document.createElement("div");
		const sizer = document.createElement("div");
		const rootEl = document.createElement("div");

		scrollContainer.classList.add("cm-scroller", "ccl-inline-card-host");
		scrollContainer.style.overflow = "auto";
		sizer.classList.add("cm-sizer");
		document.body.append(scrollContainer);
		scrollContainer.append(sizer);
		sizer.append(rootEl);

		setElementRect(rootEl, {
			top: 10,
			width: 200,
			height: 100,
		});
		setElementRect(scrollContainer, {
			top: 0,
			width: 240,
			height: 240,
		});

		const scheduleLayoutMeasurement = vi.fn();
		const stopObserving = observeVirtualListViewport({
			rootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement,
			scheduleScrollMeasurement: vi.fn(),
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});

		scrollContainer.dispatchEvent(new Event("scroll"));
		triggerResize(sizer, 240, 600);

		expect(scheduleLayoutMeasurement).not.toHaveBeenCalled();

		vi.advanceTimersByTime(140);
		await vi.runAllTimersAsync();

		expect(scheduleLayoutMeasurement).toHaveBeenCalledTimes(1);

		stopObserving();
	});

	it("keeps structure mutation measurements isolated by scroller", async () => {
		vi.useFakeTimers();

		const firstScroller = document.createElement("div");
		const secondScroller = document.createElement("div");
		const firstRootEl = document.createElement("div");
		const secondRootEl = document.createElement("div");
		const firstAddedNode = document.createElement("div");
		const secondAddedNode = document.createElement("div");

		firstScroller.style.overflow = "auto";
		secondScroller.style.overflow = "auto";
		document.body.append(firstScroller, secondScroller);
		firstScroller.append(firstRootEl);
		secondScroller.append(secondRootEl);
		firstRootEl.append(firstAddedNode);
		secondRootEl.append(secondAddedNode);

		const firstScheduleLayoutMeasurement = vi.fn();
		const secondScheduleLayoutMeasurement = vi.fn();
		const firstStopObserving = observeVirtualListViewport({
			rootEl: firstRootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: firstScheduleLayoutMeasurement,
			scheduleScrollMeasurement: vi.fn(),
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});
		const secondStopObserving = observeVirtualListViewport({
			rootEl: secondRootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: secondScheduleLayoutMeasurement,
			scheduleScrollMeasurement: vi.fn(),
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});

		expect(mutationObserverRecords).toHaveLength(2);
		const firstStructureObserver = mutationObserverRecords.find((record) =>
			record.elements.has(firstScroller),
		);
		expect(firstStructureObserver).toBeDefined();
		firstStructureObserver?.callback(
			[
				{
					type: "childList",
					target: firstRootEl,
					addedNodes: [firstAddedNode],
					removedNodes: [],
				} as unknown as MutationRecord,
				{
					type: "childList",
					target: firstRootEl,
					addedNodes: [firstAddedNode],
					removedNodes: [],
				} as unknown as MutationRecord,
			],
			{} as MutationObserver,
		);

		expect(firstScheduleLayoutMeasurement).not.toHaveBeenCalled();
		expect(secondScheduleLayoutMeasurement).not.toHaveBeenCalled();

		await vi.runOnlyPendingTimersAsync();

		expect(firstScheduleLayoutMeasurement).toHaveBeenCalledTimes(1);
		expect(secondScheduleLayoutMeasurement).not.toHaveBeenCalled();

		const secondStructureObserver = mutationObserverRecords.find((record) =>
			record.elements.has(secondScroller),
		);
		expect(secondStructureObserver).toBeDefined();
		secondStructureObserver?.callback(
			[
				{
					type: "childList",
					target: secondRootEl,
					addedNodes: [secondAddedNode],
					removedNodes: [],
				} as unknown as MutationRecord,
			],
			{} as MutationObserver,
		);

		await vi.runOnlyPendingTimersAsync();

		expect(firstScheduleLayoutMeasurement).toHaveBeenCalledTimes(1);
		expect(secondScheduleLayoutMeasurement).toHaveBeenCalledTimes(1);

		firstStopObserving();
		secondStopObserving();
	});

	it("disconnects shared observers after the last subscriber cleanup", () => {
		const scrollContainer = document.createElement("div");
		const sizer = document.createElement("div");
		const rootEl = document.createElement("div");

		scrollContainer.classList.add("cm-scroller", "ccl-inline-card-host");
		scrollContainer.style.overflow = "auto";
		sizer.classList.add("cm-sizer");
		document.body.append(scrollContainer);
		scrollContainer.append(sizer);
		sizer.append(rootEl);

		const stopObserving = observeVirtualListViewport({
			rootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement: vi.fn(),
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});

		expect(
			resizeObserverRecords.some((record) => record.elements.has(rootEl)),
		).toBe(true);
		expect(resizeObserverRecords.some((record) => record.elements.has(sizer))).toBe(
			true,
		);
		expect(
			resizeObserverRecords.some((record) =>
				record.elements.has(scrollContainer),
			),
		).toBe(true);
		expect(mutationObserverRecords[0].elements.size).toBeGreaterThan(0);

		stopObserving();

		expect(
			resizeObserverRecords.every((record) => record.elements.size === 0),
		).toBe(true);
		expect(
			mutationObserverRecords.every((record) => record.elements.size === 0),
		).toBe(true);
	});

	it("moves a root subscriber to a new scroller after its parent changes", async () => {
		vi.useFakeTimers();

		const firstScroller = document.createElement("div");
		const secondScroller = document.createElement("div");
		const firstParent = document.createElement("div");
		const secondParent = document.createElement("div");
		const rootEl = document.createElement("div");

		firstScroller.style.overflow = "auto";
		secondScroller.style.overflow = "auto";
		document.body.append(firstScroller, secondScroller);
		firstScroller.append(firstParent);
		secondScroller.append(secondParent);
		firstParent.append(rootEl);

		const onScrollContainerChange = vi.fn();
		const scheduleLayoutMeasurement = vi.fn();
		const stopObserving = observeVirtualListViewport({
			rootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange,
			scheduleLayoutMeasurement,
			scheduleScrollMeasurement: vi.fn(),
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});

		secondParent.append(rootEl);
		mutationObserverRecords[0].callback(
			[
				{
					type: "childList",
					target: firstParent,
					addedNodes: [],
					removedNodes: [rootEl],
				} as unknown as MutationRecord,
			],
			{} as MutationObserver,
		);

		await vi.runOnlyPendingTimersAsync();

		expect(onScrollContainerChange).toHaveBeenNthCalledWith(1, firstScroller);
		expect(onScrollContainerChange).toHaveBeenNthCalledWith(2, secondScroller);
		expect(scheduleLayoutMeasurement).toHaveBeenCalledTimes(1);

		stopObserving();
	});
});
