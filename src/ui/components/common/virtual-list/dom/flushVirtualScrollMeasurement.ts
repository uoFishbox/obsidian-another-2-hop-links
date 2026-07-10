import type { VirtualListMeasurementState } from "./virtualListMeasurementState";
import type { VirtualListSharedScrollMetrics } from "./sharedScrollMetrics";

/** Geometry captured before a programmatic virtual-list scroll write. */
export interface ProgrammaticScrollSnapshot {
	readonly scrollContainerEl: HTMLElement | null;
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly sectionTop: number;
	readonly didScroll: boolean;
}

export interface FlushVirtualScrollMeasurementParams {
	measurement: VirtualListMeasurementState;
	snapshot: ProgrammaticScrollSnapshot;
	updateFromCachedMeasurement: (metrics: VirtualListSharedScrollMetrics) => void;
}

/**
 * Updates cached scroll metrics before resolving a virtual navigation target.
 */
export function flushVirtualScrollMeasurement(
	params: FlushVirtualScrollMeasurementParams,
): void {
	const { measurement, snapshot, updateFromCachedMeasurement } = params;

	if (measurement.scrollContainerEl !== snapshot.scrollContainerEl) {
		measurement.scrollContainerEl = snapshot.scrollContainerEl;
	}
	if (snapshot.viewportHeight > 0) {
		measurement.viewportHeight = snapshot.viewportHeight;
		measurement.sectionTop = snapshot.sectionTop;
		measurement.hasStableScrollMetrics = true;
	}
	updateFromCachedMeasurement({
		scrollTop: snapshot.scrollTop,
		viewportHeight: snapshot.viewportHeight,
		frameId: 0,
		isScrollActive: false,
	});
}
