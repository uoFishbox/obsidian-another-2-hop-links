import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetScrollActivityForTests } from "ui/virtualization/scheduling/scrollActivity";
import {
	installMutationObserverMock,
	installResizeObserverMock,
	mutationObserverRecords,
	resetRecords,
	teardownMutationObserverMock,
	teardownResizeObserverMock,
} from "testing/helpers/DOMObserverMock";
import { observeVirtualListViewport } from "../virtualListDomObserver";

const SCROLLER_COUNT = 32;

const flushScheduledMeasurements = async (): Promise<void> => {
	await vi.runOnlyPendingTimersAsync();
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
					rootEl,
					onWidthChange: vi.fn(),
					onScrollContainerChange: vi.fn(),
					scheduleLayoutMeasurement: scheduleLayoutMeasurements[index],
					scheduleScrollMeasurement: vi.fn(),
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
});
