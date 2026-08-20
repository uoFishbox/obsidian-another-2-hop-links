import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetScrollActivityForTests } from "ui/shared/scroll/scrollActivity";
import {
	createVirtualFrameCoordinator,
	type VirtualFrameCoordinator,
} from "ui/shared/scheduling/frameCoordinator";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import {
	installMutationObserverMock,
	installResizeObserverMock,
	mutationObserverRecords,
	resetRecords,
	teardownMutationObserverMock,
	teardownResizeObserverMock,
} from "testing/helpers/DOMObserverMock";
import { observeVirtualViewport as observeVirtualListViewport } from "../observeVirtualViewport";

const SCROLLER_COUNT = 32;

const flushScheduledMeasurements = async (): Promise<void> => {
	await vi.runOnlyPendingTimersAsync();
};

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

const createMutationRecord = (params: {
	target: Node;
	addedNodes: readonly Node[];
}): MutationRecord =>
	({
		type: "childList",
		target: params.target,
		addedNodes: params.addedNodes,
		removedNodes: [],
	}) as unknown as MutationRecord;

describe("VirtualListDomObserver performance contracts", () => {
	const stopObserving: Array<() => void> = [];

	beforeEach(() => {
		resetRecords();
		installResizeObserverMock();
		installMutationObserverMock();
	});

	afterEach(() => {
		for (const stop of stopObserving.splice(0)) {
			stop();
		}
		for (const coordinator of observerFrameCoordinators.splice(0)) {
			coordinator.dispose();
		}
		document.body.innerHTML = "";
		resetScrollActivityForTests();
		vi.useRealTimers();
		teardownResizeObserverMock();
		teardownMutationObserverMock();
	});

	it("isolates structure mutation measurements across scrollers", async () => {
		vi.useFakeTimers();

		const scrollers = Array.from({ length: SCROLLER_COUNT }, () => {
			const scroller = document.createElement("div");
			scroller.style.overflow = "auto";
			document.body.append(scroller);
			return scroller;
		});

		const roots = scrollers.map((scroller) => {
			const root = document.createElement("div");
			scroller.append(root);
			return root;
		});
		const scheduleLayoutMeasurements = roots.map(() => vi.fn());

		for (const [index, rootEl] of roots.entries()) {
			stopObserving.push(
				observeVirtualListViewport({
					frameCoordinator: createObserverFrameCoordinator(),
					rootEl,
					onWidthChange: vi.fn(),
					onScrollContainerChange: vi.fn(),
					scheduleLayoutMeasurement: scheduleLayoutMeasurements[index],
					scheduleScrollMeasurement,
					runScrollMeasurement: vi.fn(),
					runInitialLayoutMeasurement: vi.fn(),
				}),
			);
		}

		expect(mutationObserverRecords).toHaveLength(SCROLLER_COUNT);
		const structureObserver = mutationObserverRecords.find((record) =>
			record.elements.has(scrollers[0]),
		);
		expect(structureObserver).toBeDefined();
		const localChild = document.createElement("span");
		roots[0].append(localChild);
		structureObserver?.callback(
			[
				createMutationRecord({
					target: roots[0],
					addedNodes: [localChild],
				}),
				createMutationRecord({
					target: roots[0],
					addedNodes: [localChild],
				}),
			],
			{} as MutationObserver,
		);
		await flushScheduledMeasurements();

		expect(
			scheduleLayoutMeasurements.map(
				(measurement) => measurement.mock.calls.length,
			),
		).toEqual([1, ...Array.from({ length: SCROLLER_COUNT - 1 }, () => 0)]);
	});

	it("bounds scroll task executions by coverage misses plus gesture count", async () => {
		vi.useFakeTimers();

		const SCROLL_FRAMES = 300;
		const MISS_EVERY_N_FRAMES = 30;

		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		document.body.append(scroller);
		const rootEl = document.createElement("div");
		scroller.append(rootEl);

		let scrollTop = 0;
		Object.defineProperty(scroller, "scrollTop", {
			get: () => scrollTop,
			configurable: true,
		});

		let frame = 0;
		const observation = observeVirtualListViewport({
			frameCoordinator: createObserverFrameCoordinator(),
			rootEl,
			onWidthChange: vi.fn(),
			getCachedViewportHeight: () => 240,
			onScrollContainerChange: vi.fn(),
			scheduleLayoutMeasurement: vi.fn(),
			scheduleScrollMeasurement,
			runScrollMeasurement: vi.fn(),
			runInitialLayoutMeasurement: vi.fn(),
		});
		stopObserving.push(observation);
		resetCCLDevMeasurements();

		// rAF-driven programmatic scroll stream, one scroll event per frame
		for (frame = 0; frame < SCROLL_FRAMES; frame += 1) {
			// Deterministic pushed coverage: every Nth frame publishes no
			// coverage (miss); all other frames publish an open interval hit.
			observation.publishScrollMeasurementRange(
				frame % MISS_EVERY_N_FRAMES === 0
					? null
					: {
							minScrollTopBeforeMeasurement: -1,
							maxScrollTopBeforeMeasurement: Number.MAX_SAFE_INTEGER,
						},
			);
			scrollTop += 20;
			scroller.dispatchEvent(new Event("scroll"));
			await vi.advanceTimersByTimeAsync(16);
		}

		// Settle: idle debounce plus the final idle measurement task
		await vi.advanceTimersByTimeAsync(140);
		await vi.runAllTimersAsync();

		const counters = getCCLDevMeasurementSnapshot().counters;
		const scrollEvents = counters["virtualList.observer.scrollEvent"].count;
		const coverageHits = counters["virtualList.observer.coverageHit"].count;
		const coverageMisses = counters["virtualList.observer.coverageMiss"].count;
		const scrollTasksExecuted =
			counters["virtualList.observer.scrollTask.executed"].count;
		const scrollGestureCount = 1;

		expect(scrollEvents).toBe(SCROLL_FRAMES);
		expect(coverageHits + coverageMisses).toBe(SCROLL_FRAMES);
		expect(coverageMisses).toBe(SCROLL_FRAMES / MISS_EVERY_N_FRAMES);
		// Contract: coverage hits never turn into scroll tasks; only misses
		// and the per-gesture idle normalization may execute measurements.
		expect(scrollTasksExecuted).toBeLessThanOrEqual(
			coverageMisses + scrollGestureCount,
		);
	});
});
