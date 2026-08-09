import type { TwoHopScrollCoverage } from "features/two-hop/ui/twoHopWindowPolicy";
import type { ScrollMeasurementRange } from "ui/virtualization/core/scrollWindowGate";
import {
	observeVirtualListViewport,
	type VirtualListSharedScrollMetrics,
} from "ui/virtualization/dom/virtualListDomObserver";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

const TWO_HOP_SCROLL_MEASUREMENT_TASK_KEY = "two-hop-progressive-preview-window";

export interface ObserveTwoHopViewportOptions {
	readonly rootEl: HTMLElement;
	readonly frameCoordinator: VirtualFrameCoordinator;
	readonly getCachedViewportHeight: () => number;
	readonly getScrollCoverage: () => TwoHopScrollCoverage | null;
	readonly onRootWidthChange?: (width: number) => void;
	readonly onScrollContainerChange: (element: HTMLElement | null) => void;
	readonly onScrollActiveChange: (active: boolean) => void;
	readonly runInitialLayoutMeasurement: () => void;
	readonly runLayoutMeasurement: () => void;
	readonly runScrollMeasurement: (metrics: VirtualListSharedScrollMetrics) => void;
}

export interface TwoHopViewportObservation {
	dispose(): void;
	publishScrollCoverage(coverage: TwoHopScrollCoverage | null): void;
}

/**
 * Connects the two-hop surface to the shared virtual viewport observer.
 *
 * Scroll phase, idle detection, dependency observation, resize observation,
 * and coverage gating stay owned by the shared observer. The two-hop feature
 * only supplies its window measurement and publication callbacks.
 */
export function observeTwoHopViewport(
	options: ObserveTwoHopViewportOptions,
): TwoHopViewportObservation {
	const observation = observeVirtualListViewport({
		rootEl: options.rootEl,
		onWidthChange: (width) => options.onRootWidthChange?.(width),
		measureOnRootHeightChange: false,
		getCachedViewportHeight: options.getCachedViewportHeight,
		getScrollMeasurementRange: () =>
			toScrollMeasurementRange(options.getScrollCoverage()),
		onScrollContainerChange: options.onScrollContainerChange,
		scheduleLayoutMeasurement: options.runLayoutMeasurement,
		scheduleScrollMeasurement: (task) => {
			if (!task) return;
			options.frameCoordinator.schedule(
				"scroll-critical",
				TWO_HOP_SCROLL_MEASUREMENT_TASK_KEY,
				task,
			);
		},
		runScrollMeasurement: (metrics) => {
			if (!metrics) return;
			options.runScrollMeasurement(metrics);
		},
		runInitialLayoutMeasurement: options.runInitialLayoutMeasurement,
		onScrollStateChange: (_generation, _hasPendingScrollTop, isScrollActive) => {
			options.onScrollActiveChange(isScrollActive);
		},
	});

	return {
		dispose(): void {
			options.frameCoordinator.cancel(
				"scroll-critical",
				TWO_HOP_SCROLL_MEASUREMENT_TASK_KEY,
			);
			observation();
		},
		publishScrollCoverage(coverage): void {
			observation.publishScrollMeasurementRange(
				toScrollMeasurementRange(coverage),
			);
		},
	};
}

function toScrollMeasurementRange(
	coverage: TwoHopScrollCoverage | null,
): ScrollMeasurementRange | null {
	if (!coverage) return null;
	return {
		minScrollTopBeforeMeasurement: coverage.min,
		maxScrollTopBeforeMeasurement: coverage.max,
	};
}
