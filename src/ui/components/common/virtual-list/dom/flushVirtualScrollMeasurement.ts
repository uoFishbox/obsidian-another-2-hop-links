import type { VirtualListMeasurementState } from "./virtualListMeasurementState";

export interface FlushVirtualScrollMeasurementParams {
	measurement: VirtualListMeasurementState;
	scrollContainerEl: HTMLElement | null;
	targetTop: number;
	updateFromCachedMeasurement: () => void;
}

/**
 * Updates cached scroll metrics before resolving a virtual navigation target.
 */
export function flushVirtualScrollMeasurement(
	params: FlushVirtualScrollMeasurementParams,
): void {
	const { measurement, scrollContainerEl, targetTop, updateFromCachedMeasurement } =
		params;

	if (measurement.scrollContainerEl !== scrollContainerEl) {
		measurement.scrollContainerEl = scrollContainerEl;
	}
	if (scrollContainerEl && scrollContainerEl.clientHeight > 0) {
		measurement.viewportHeight = scrollContainerEl.clientHeight;
		measurement.sectionTop = Math.max(0, scrollContainerEl.scrollTop - targetTop);
		measurement.hasStableScrollMetrics = true;
	}
	updateFromCachedMeasurement();
}
