import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeVirtualViewport as observeVirtualListViewport } from "../scrollerRegistry";
import { resetScrollActivityForTests } from "shared/ui/scroll/scrollActivity";
import {
	createVirtualFrameCoordinator,
	type VirtualFrameCoordinator,
} from "shared/ui/scheduling/frameCoordinator";
import {
	installMutationObserverMock,
	installAnimationFrameMock,
	installResizeObserverMock,
	flushFrames,
	mutationObserverRecords,
	resetRecords,
	resizeObserverRecords,
	setElementRect,
	teardownAnimationFrameMock,
	teardownMutationObserverMock,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";

const observerFrameCoordinators: VirtualFrameCoordinator[] = [];

const createObserverFrameCoordinator = (): VirtualFrameCoordinator => {
	const coordinator = createVirtualFrameCoordinator();
	observerFrameCoordinators.push(coordinator);
	return coordinator;
};

const scheduleScrollMeasurement = (task?: () => void): void => {
	if (!task) return;
	window.requestAnimationFrame(task);
};

describe("observeVirtualListViewport", () => {
	beforeEach(() => {
		resetRecords();
		installResizeObserverMock();
		installMutationObserverMock();
	});

	afterEach(() => {
		for (const coordinator of observerFrameCoordinators.splice(0)) {
			coordinator.dispose();
		}
		document.body.innerHTML = "";
		resetScrollActivityForTests();
		vi.useRealTimers();
		teardownResizeObserverMock();
		teardownMutationObserverMock();
	});

	it("rebinds from window to an element scroller attached after the initial bind", async () => {
		installAnimationFrameMock();

		const wrapper = document.createElement("div");
		const rootEl = document.createElement("div");
		wrapper.append(rootEl);
		document.body.append(wrapper);

		setElementRect(rootEl, {
			top: 10,
			width: 200,
			height: 100,
		});

		const onScrollContainerChange = vi.fn();
		const scheduleLayoutMeasurement = vi.fn();
		const runScrollMeasurement = vi.fn();
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			onScrollContainerChange,
			scheduleLayoutMeasurement,
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});

		const scrollContainer = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		Object.defineProperty(scrollContainer, "scrollHeight", {
			configurable: true,
			value: 1000,
		});
		Object.defineProperty(scrollContainer, "clientHeight", {
			configurable: true,
			value: 240,
		});
		Object.defineProperty(scrollContainer, "scrollTop", {
			configurable: true,
			value: 320,
		});
		document.body.append(scrollContainer);
		scrollContainer.append(wrapper);

		try {
			expect(onScrollContainerChange).toHaveBeenNthCalledWith(1, null);

			await flushFrames();

			expect(onScrollContainerChange).toHaveBeenNthCalledWith(2, scrollContainer);
			expect(scheduleLayoutMeasurement).toHaveBeenCalledTimes(1);

			scrollContainer.dispatchEvent(new Event("scroll"));
			await flushFrames();

			expect(runScrollMeasurement).toHaveBeenCalledWith(
				expect.objectContaining({ scrollTop: 320 }),
				"scroll-coverage-miss",
			);
		} finally {
			stopObserving();
			teardownAnimationFrameMock();
		}
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
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
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
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl: firstRootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});
		const secondStopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl: secondRootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
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
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement,
			scheduleScrollMeasurement,
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

	it("retains structure mutations during scroll and measures layout once at idle", async () => {
		vi.useFakeTimers();

		const scrollContainer = document.createElement("div");
		const content = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(content);
		content.append(rootEl);

		const scheduleLayoutMeasurement = vi.fn();
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement,
			scheduleScrollMeasurement,
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});
		const structureObserver = mutationObserverRecords[0];
		expect(structureObserver).toBeDefined();

		try {
			scrollContainer.dispatchEvent(new Event("scroll"));
			expect(structureObserver?.elements.has(content)).toBe(true);

			const sibling = document.createElement("div");
			content.insertBefore(sibling, rootEl);
			structureObserver?.callback(
				[
					{
						type: "childList",
						target: content,
						addedNodes: [sibling],
						removedNodes: [],
					} as unknown as MutationRecord,
				],
				{} as MutationObserver,
			);

			expect(scheduleLayoutMeasurement).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(140);
			await vi.runAllTimersAsync();

			expect(scheduleLayoutMeasurement).toHaveBeenCalledTimes(1);
		} finally {
			stopObserving();
		}
	});

	it("shares one registry entry for window scrolling", () => {
		const firstRootEl = document.createElement("div");
		const secondRootEl = document.createElement("div");
		document.body.append(firstRootEl, secondRootEl);

		const firstStopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl: firstRootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});
		const secondStopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl: secondRootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});

		expect(mutationObserverRecords).toHaveLength(1);
		const rootResizeRecord = resizeObserverRecords.find((record) =>
			record.elements.has(secondRootEl),
		);
		expect(rootResizeRecord?.elements.has(firstRootEl)).toBe(false);

		firstStopObserving();
		expect(mutationObserverRecords[0]?.elements.size).toBeGreaterThan(0);
		secondStopObserving();
		expect(mutationObserverRecords[0]?.elements.size).toBe(0);
	});

	it("resets observation-scoped measurement state on every window bind", () => {
		const rootEl = document.createElement("div");
		document.body.append(rootEl);
		let migrate: ((ownerWindow: Window) => void) | undefined;
		Object.defineProperty(rootEl, "onWindowMigrated", {
			configurable: true,
			value: (listener: (ownerWindow: Window) => void) => {
				migrate = listener;
				return vi.fn();
			},
		});
		const resetMeasurementForObservation = vi.fn();
		const runInitialLayoutMeasurement = vi.fn();
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement,
			resetMeasurementForObservation,
		});

		try {
			expect(resetMeasurementForObservation).toHaveBeenCalledOnce();
			expect(runInitialLayoutMeasurement).toHaveBeenCalledOnce();

			migrate?.(window);

			expect(resetMeasurementForObservation).toHaveBeenCalledTimes(2);
			expect(runInitialLayoutMeasurement).toHaveBeenCalledTimes(2);
		} finally {
			stopObserving();
		}
	});

	it("reads scrollTop in the native event and runs measurement in the next frame", async () => {
		installAnimationFrameMock();
		const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");

		scrollContainer.classList.add("cm-scroller", "ccl-inline-card-host");
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

		let scrollTop = 120;
		let clientHeight = 240;
		const scrollTopGetter = vi.fn(() => scrollTop);
		const clientHeightGetter = vi.fn(() => clientHeight);
		const rootRectGetter = vi.spyOn(rootEl, "getBoundingClientRect");
		const scrollerRectGetter = vi.spyOn(scrollContainer, "getBoundingClientRect");
		Object.defineProperty(scrollContainer, "scrollHeight", {
			value: 1000,
			configurable: true,
		});
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: scrollTopGetter,
			configurable: true,
		});
		Object.defineProperty(scrollContainer, "clientHeight", {
			get: clientHeightGetter,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const onScrollContainerChange = vi.fn();
		const onScrollStateChange = vi.fn();
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			onScrollContainerChange,
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
			onScrollStateChange,
		});

		scrollTopGetter.mockClear();
		clientHeightGetter.mockClear();
		rootRectGetter.mockClear();
		scrollerRectGetter.mockClear();
		requestAnimationFrame.mockClear();

		try {
			scrollContainer.dispatchEvent(new Event("scroll"));
			scrollTop = 180;
			clientHeight = 300;

			expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
			expect(runScrollMeasurement).not.toHaveBeenCalled();
			await flushFrames();
		} finally {
			stopObserving();
			requestAnimationFrame.mockRestore();
			teardownAnimationFrameMock();
		}

		expect(onScrollContainerChange).toHaveBeenCalledWith(scrollContainer);
		expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
		expect(runScrollMeasurement).toHaveBeenCalledWith(
			expect.objectContaining({
				scrollTop: 120,
				viewportHeight: 240,
				frameId: expect.any(Number),
				isScrollActive: true,
				scrollGeneration: 1,
			}),
			"scroll-coverage-miss",
		);
		expect(onScrollStateChange.mock.calls).toEqual([
			[0, false, false],
			[0, false, true],
			[1, false, true],
		]);
		expect(scrollTopGetter).toHaveBeenCalledTimes(1);
		expect(clientHeightGetter).not.toHaveBeenCalled();
		expect(rootRectGetter).not.toHaveBeenCalled();
		expect(scrollerRectGetter).not.toHaveBeenCalled();
	});

	it("does not schedule a scroll measurement inside the controller range", async () => {
		installAnimationFrameMock();
		const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 120;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const getScrollMeasurementRange = vi.fn(() => ({
			minScrollTopBeforeMeasurement: 100,
			maxScrollTopBeforeMeasurement: 150,
		}));
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		requestAnimationFrame.mockClear();
		getScrollMeasurementRange.mockClear();

		try {
			scrollContainer.dispatchEvent(new Event("scroll"));
			scrollTop = 140;
			scrollContainer.dispatchEvent(new Event("scroll"));
			await flushFrames();

			expect(runScrollMeasurement).not.toHaveBeenCalled();
			expect(requestAnimationFrame).not.toHaveBeenCalled();
			// The published primitive gate avoids callbacks on the scroll path.
			expect(getScrollMeasurementRange).not.toHaveBeenCalled();

			scrollTop = 150;
			scrollContainer.dispatchEvent(new Event("scroll"));
			scrollTop = 180;
			scrollContainer.dispatchEvent(new Event("scroll"));
			expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
			await flushFrames();

			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
			expect(runScrollMeasurement).toHaveBeenCalledWith(
				expect.objectContaining({ scrollTop: 180 }),
				"scroll-coverage-miss",
			);
		} finally {
			stopObserving();
			requestAnimationFrame.mockRestore();
			teardownAnimationFrameMock();
		}
	});

	it("skips a pending coverage-miss task when the latest position recovers", async () => {
		installAnimationFrameMock();

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 300;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange: () => ({
				minScrollTopBeforeMeasurement: 100,
				maxScrollTopBeforeMeasurement: 200,
			}),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});

		try {
			scrollContainer.dispatchEvent(new Event("scroll"));
			scrollTop = 150;
			scrollContainer.dispatchEvent(new Event("scroll"));
			await flushFrames();

			expect(runScrollMeasurement).not.toHaveBeenCalled();
		} finally {
			stopObserving();
			teardownAnimationFrameMock();
		}
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
		let firstStopObserving: (() => void) | null = null;
		let secondStopObserving: (() => void) | null = null;

		try {
			firstStopObserving = observeVirtualListViewport({
				frameCoordinator: createObserverFrameCoordinator(),
				rootEl: firstRootEl,
				onWidthChange: vi.fn(),
				onScrollContainerChange: vi.fn(),
				scheduleLayoutMeasurement: firstScheduleLayoutMeasurement,
				scheduleScrollMeasurement,
				runScrollMeasurement: vi.fn(),
				runInitialLayoutMeasurement: vi.fn(),
			});
			secondStopObserving = observeVirtualListViewport({
				frameCoordinator: createObserverFrameCoordinator(),
				rootEl: secondRootEl,
				onWidthChange: vi.fn(),
				onScrollContainerChange: vi.fn(),
				scheduleLayoutMeasurement: secondScheduleLayoutMeasurement,
				scheduleScrollMeasurement,
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

			expect(firstScheduleLayoutMeasurement).toHaveBeenCalledTimes(1);
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
		} finally {
			firstStopObserving?.();
			secondStopObserving?.();
		}
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
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
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
		let stopObserving: (() => void) | null = null;

		try {
			stopObserving = observeVirtualListViewport({
				frameCoordinator: createObserverFrameCoordinator(),
				rootEl,
				onWidthChange: vi.fn(),
				onScrollContainerChange,
				scheduleLayoutMeasurement,
				scheduleScrollMeasurement,
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
		} finally {
			stopObserving?.();
		}
	});

	it("schedules one measurement when a root resize moves it to a new scroller", () => {
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
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			onScrollContainerChange,
			scheduleLayoutMeasurement,
			scheduleScrollMeasurement,
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});

		try {
			triggerResize(rootEl, 200, 100);
			scheduleLayoutMeasurement.mockClear();

			secondParent.append(rootEl);
			triggerResize(rootEl, 200, 100);

			expect(onScrollContainerChange).toHaveBeenNthCalledWith(2, secondScroller);
			expect(scheduleLayoutMeasurement).toHaveBeenCalledTimes(1);
		} finally {
			stopObserving();
		}
	});

	it("treats coverage boundary values as miss (open interval)", async () => {
		installAnimationFrameMock();
		const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 100;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const getScrollMeasurementRange = vi.fn(() => ({
			minScrollTopBeforeMeasurement: 100,
			maxScrollTopBeforeMeasurement: 200,
		}));
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		requestAnimationFrame.mockClear();

		try {
			// scrollTop === min (100) → miss
			scrollContainer.dispatchEvent(new Event("scroll"));
			expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
			await flushFrames();
			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);

			requestAnimationFrame.mockClear();
			runScrollMeasurement.mockClear();

			// scrollTop === max (200) → miss
			scrollTop = 200;
			scrollContainer.dispatchEvent(new Event("scroll"));
			expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
			await flushFrames();
			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);

			requestAnimationFrame.mockClear();
			runScrollMeasurement.mockClear();

			// scrollTop strictly inside (150) → hit
			scrollTop = 150;
			scrollContainer.dispatchEvent(new Event("scroll"));
			expect(requestAnimationFrame).not.toHaveBeenCalled();
			await flushFrames();
			expect(runScrollMeasurement).not.toHaveBeenCalled();
		} finally {
			stopObserving();
			requestAnimationFrame.mockRestore();
			teardownAnimationFrameMock();
		}
	});

	it("runs idle measurement after a coverage-hit-only scroll gesture", async () => {
		vi.useFakeTimers();

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 120;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const getScrollMeasurementRange = vi.fn(() => ({
			minScrollTopBeforeMeasurement: 100,
			maxScrollTopBeforeMeasurement: 200,
		}));
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		runScrollMeasurement.mockClear();

		try {
			// All scroll events are coverage hits
			scrollTop = 130;
			scrollContainer.dispatchEvent(new Event("scroll"));
			scrollTop = 140;
			scrollContainer.dispatchEvent(new Event("scroll"));
			scrollTop = 150;
			scrollContainer.dispatchEvent(new Event("scroll"));

			expect(runScrollMeasurement).not.toHaveBeenCalled();

			// The idle debounce timer triggers idle normalization
			await vi.advanceTimersByTimeAsync(140);
			await vi.runAllTimersAsync();

			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
			expect(runScrollMeasurement).toHaveBeenCalledWith(
				expect.objectContaining({ scrollTop: 150 }),
				"scroll-idle",
			);
		} finally {
			stopObserving();
		}
	});

	it("keeps a programmatic scroll stream active across per-frame scrollend events", async () => {
		vi.useFakeTimers();

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 110;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});
		// Simulate a scrollend-capable environment: per-frame programmatic
		// scrolls fire scrollend after every scrollTop mutation.
		Object.defineProperty(scrollContainer, "onscrollend", {
			value: null,
			writable: true,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const getScrollMeasurementRange = vi.fn(() => ({
			minScrollTopBeforeMeasurement: 100,
			maxScrollTopBeforeMeasurement: 200,
		}));
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		runScrollMeasurement.mockClear();

		try {
			// rAF-driven programmatic scroll: scroll + scrollend on every frame
			for (let frame = 0; frame < 5; frame += 1) {
				scrollTop += 10;
				scrollContainer.dispatchEvent(new Event("scroll"));
				scrollContainer.dispatchEvent(new Event("scrollend"));
				await vi.advanceTimersByTimeAsync(16);
			}

			// Intermediate scrollend events must not run idle measurements
			expect(runScrollMeasurement).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(140);
			await vi.runAllTimersAsync();

			// The whole stream settles as one gesture with one idle measurement
			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
			expect(runScrollMeasurement).toHaveBeenCalledWith(
				expect.objectContaining({ scrollTop: 160 }),
				"scroll-idle",
			);
		} finally {
			stopObserving();
		}
	});

	it("runs a single idle measurement only after the quiet period", async () => {
		vi.useFakeTimers();

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 120;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const getScrollMeasurementRange = vi.fn(() => ({
			minScrollTopBeforeMeasurement: 100,
			maxScrollTopBeforeMeasurement: 200,
		}));
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		runScrollMeasurement.mockClear();

		try {
			scrollTop = 130;
			scrollContainer.dispatchEvent(new Event("scroll"));
			scrollTop = 140;
			scrollContainer.dispatchEvent(new Event("scroll"));

			// One tick before the idle threshold: still active, no measurement
			await vi.advanceTimersByTimeAsync(139);
			expect(runScrollMeasurement).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			await vi.runAllTimersAsync();

			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
			expect(runScrollMeasurement).toHaveBeenCalledWith(
				expect.objectContaining({ scrollTop: 140 }),
				"scroll-idle",
			);
		} finally {
			stopObserving();
		}
	});

	it("keeps the coverage-miss reason when idle fires before the task runs", async () => {
		vi.useFakeTimers();
		const rafQueue: FrameRequestCallback[] = [];
		const rafSpy = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				rafQueue.push(callback);
				return rafQueue.length;
			});

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 300;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const getScrollMeasurementRange = vi.fn(() => ({
			minScrollTopBeforeMeasurement: 100,
			maxScrollTopBeforeMeasurement: 200,
		}));
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		runScrollMeasurement.mockClear();
		rafQueue.length = 0;

		try {
			// Coverage miss schedules the task with reason "scroll-coverage-miss"
			scrollContainer.dispatchEvent(new Event("scroll"));
			expect(rafQueue).toHaveLength(1);

			// Idle fires before the scheduled rAF task executes; it must not
			// reclassify the pending task as "scroll-idle".
			await vi.advanceTimersByTimeAsync(140);
			expect(runScrollMeasurement).not.toHaveBeenCalled();

			for (const callback of rafQueue.splice(0)) {
				callback(0);
			}

			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
			expect(runScrollMeasurement).toHaveBeenCalledWith(
				expect.anything(),
				"scroll-coverage-miss",
			);
		} finally {
			stopObserving();
			rafSpy.mockRestore();
		}
	});

	it("uses a newly published controller range without stale coverage", async () => {
		installAnimationFrameMock();

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 150;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		let rangeMin = 100;
		let rangeMax = 200;
		const getScrollMeasurementRange = vi.fn(() => ({
			minScrollTopBeforeMeasurement: rangeMin,
			maxScrollTopBeforeMeasurement: rangeMax,
		}));
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		runScrollMeasurement.mockClear();

		try {
			// Initially 150 is inside [100, 200] → hit
			scrollContainer.dispatchEvent(new Event("scroll"));
			await flushFrames();
			expect(runScrollMeasurement).not.toHaveBeenCalled();

			// Controller range shrinks (simulating data/layout change)
			rangeMin = 100;
			rangeMax = 140;
			stopObserving.publishScrollMeasurementRange(getScrollMeasurementRange());

			// Now 150 is outside [100, 140] → miss.
			scrollContainer.dispatchEvent(new Event("scroll"));
			await flushFrames();
			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
			expect(runScrollMeasurement).toHaveBeenCalledWith(
				expect.objectContaining({ scrollTop: 150 }),
				"scroll-coverage-miss",
			);
		} finally {
			stopObserving();
			teardownAnimationFrameMock();
		}
	});

	it("coalesces multiple coverage misses in the same frame into one measurement", async () => {
		installAnimationFrameMock();
		const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 300;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const getScrollMeasurementRange = vi.fn(() => ({
			minScrollTopBeforeMeasurement: 100,
			maxScrollTopBeforeMeasurement: 200,
		}));
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		requestAnimationFrame.mockClear();
		runScrollMeasurement.mockClear();

		try {
			// Multiple misses before frame fires
			scrollTop = 300;
			scrollContainer.dispatchEvent(new Event("scroll"));
			scrollTop = 350;
			scrollContainer.dispatchEvent(new Event("scroll"));
			scrollTop = 400;
			scrollContainer.dispatchEvent(new Event("scroll"));

			// Only one rAF scheduled
			expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
			await flushFrames();

			// Single measurement with latest scrollTop
			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
			expect(runScrollMeasurement).toHaveBeenCalledWith(
				expect.objectContaining({ scrollTop: 400 }),
				"scroll-coverage-miss",
			);
		} finally {
			stopObserving();
			requestAnimationFrame.mockRestore();
			teardownAnimationFrameMock();
		}
	});

	it("schedules measurement on jump scroll beyond coverage", async () => {
		installAnimationFrameMock();
		const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 150;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const getScrollMeasurementRange = vi.fn(() => ({
			minScrollTopBeforeMeasurement: 100,
			maxScrollTopBeforeMeasurement: 200,
		}));
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		requestAnimationFrame.mockClear();
		runScrollMeasurement.mockClear();

		try {
			// Large jump far beyond coverage
			scrollTop = 5000;
			scrollContainer.dispatchEvent(new Event("scroll"));

			expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
			await flushFrames();

			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
			expect(runScrollMeasurement).toHaveBeenCalledWith(
				expect.objectContaining({ scrollTop: 5000 }),
				"scroll-coverage-miss",
			);
		} finally {
			stopObserving();
			requestAnimationFrame.mockRestore();
			teardownAnimationFrameMock();
		}
	});

	it("schedules measurement when the controller range is unavailable", async () => {
		installAnimationFrameMock();
		const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");

		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		document.body.append(scrollContainer);
		scrollContainer.append(rootEl);

		let scrollTop = 150;
		Object.defineProperty(scrollContainer, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		const runScrollMeasurement = vi.fn();
		const getScrollMeasurementRange = vi.fn(() => null);
		const stopObserving = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			getScrollMeasurementRange,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement,
			runInitialLayoutMeasurement: vi.fn(),
		});
		requestAnimationFrame.mockClear();
		runScrollMeasurement.mockClear();

		try {
			// null range → always miss
			scrollContainer.dispatchEvent(new Event("scroll"));
			expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
			await flushFrames();
			expect(runScrollMeasurement).toHaveBeenCalledTimes(1);
		} finally {
			stopObserving();
			requestAnimationFrame.mockRestore();
			teardownAnimationFrameMock();
		}
	});
});
