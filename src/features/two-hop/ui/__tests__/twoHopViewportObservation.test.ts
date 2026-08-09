import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	observeTwoHopViewport,
	type ObserveTwoHopViewportOptions,
} from "features/two-hop/ui/twoHopViewportObservation";
import type { ObserveVirtualListViewportOptions } from "ui/virtualization/dom/virtualListDomObserver";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

const sharedObserver = vi.hoisted(() => ({
	observe: vi.fn(),
	publishRange: vi.fn(),
	stop: vi.fn(),
}));

vi.mock("ui/virtualization/dom/virtualListDomObserver", () => ({
	observeVirtualListViewport: sharedObserver.observe,
}));

function createCoordinator(): VirtualFrameCoordinator {
	return {
		schedule: vi.fn(() => true),
		cancel: vi.fn(),
		isScheduled: vi.fn(() => false),
		dispose: vi.fn(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	const observation = Object.assign(sharedObserver.stop, {
		publishScrollMeasurementRange: sharedObserver.publishRange,
	});
	sharedObserver.observe.mockReturnValue(observation);
});

describe("observeTwoHopViewport", () => {
	it("adapts two-hop coverage and scheduling to the shared viewport observer", () => {
		const frameCoordinator = createCoordinator();
		const onScrollContainerChange = vi.fn();
		const onScrollActiveChange = vi.fn();
		const runInitialLayoutMeasurement = vi.fn();
		const runLayoutMeasurement = vi.fn();
		const runScrollMeasurement = vi.fn();
		const options: ObserveTwoHopViewportOptions = {
			rootEl: {} as HTMLElement,
			frameCoordinator,
			getCachedViewportHeight: () => 480,
			getScrollCoverage: () => ({ min: 100, max: 900 }),
			onScrollContainerChange,
			onScrollActiveChange,
			runInitialLayoutMeasurement,
			runLayoutMeasurement,
			runScrollMeasurement,
		};

		const observation = observeTwoHopViewport(options);
		const sharedOptions = sharedObserver.observe.mock.calls[0]?.[0] as
			| ObserveVirtualListViewportOptions
			| undefined;
		if (!sharedOptions) throw new Error("Shared observer was not created");

		expect(sharedOptions.getScrollMeasurementRange?.()).toEqual({
			minScrollTopBeforeMeasurement: 100,
			maxScrollTopBeforeMeasurement: 900,
		});
		expect(sharedOptions.getCachedViewportHeight?.()).toBe(480);

		const scrollTask = vi.fn();
		sharedOptions.scheduleScrollMeasurement(scrollTask);
		expect(frameCoordinator.schedule).toHaveBeenCalledWith(
			"scroll-critical",
			"two-hop-progressive-preview-window",
			scrollTask,
		);

		const metrics = {
			scrollTop: 320,
			viewportHeight: 480,
			frameId: 1,
			isScrollActive: true,
			scrollGeneration: 2,
		};
		sharedOptions.runScrollMeasurement(metrics);
		expect(runScrollMeasurement).toHaveBeenCalledWith(metrics);

		sharedOptions.onScrollStateChange?.(2, true, true);
		expect(onScrollActiveChange).toHaveBeenCalledWith(true);
		sharedOptions.scheduleLayoutMeasurement();
		expect(runLayoutMeasurement).toHaveBeenCalledOnce();
		sharedOptions.runInitialLayoutMeasurement();
		expect(runInitialLayoutMeasurement).toHaveBeenCalledOnce();

		observation.publishScrollCoverage({ min: 200, max: 800 });
		expect(sharedObserver.publishRange).toHaveBeenCalledWith({
			minScrollTopBeforeMeasurement: 200,
			maxScrollTopBeforeMeasurement: 800,
		});

		observation.dispose();
		expect(frameCoordinator.cancel).toHaveBeenCalledWith(
			"scroll-critical",
			"two-hop-progressive-preview-window",
		);
		expect(sharedObserver.stop).toHaveBeenCalledOnce();
	});
});
