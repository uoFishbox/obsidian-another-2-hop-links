import type { VirtualListMeasurementStateHandle } from "./virtualListMeasurementState";
import { createPostPaintVirtualListTask } from "./virtualListScheduler";

export interface InitialVirtualListStabilizationOptions {
	measurement: VirtualListMeasurementStateHandle;
	runLayoutMeasurement: () => void;
	getRootEl: () => HTMLElement | null;
	getWindow: () => Window | null;
	maxPasses?: number;
}

export interface InitialVirtualListStabilization {
	schedule(): void;
	cancel(): void;
	cancelBecauseScrollStarted(): void;
}

export function createInitialVirtualListStabilization({
	measurement,
	runLayoutMeasurement,
	getRootEl,
	getWindow,
	maxPasses = 2,
}: InitialVirtualListStabilizationOptions): InitialVirtualListStabilization {
	let passCount = 0;
	let completed = false;
	let cancelledByScroll = false;

	const run = () => {
		if (completed || cancelledByScroll) {
			return;
		}

		const rootEl = getRootEl();
		if (!rootEl || !getWindow()) {
			return;
		}

		passCount += 1;
		runLayoutMeasurement();

		if (measurement.hasStableScrollMetrics && measurement.hasStableVisibleRange) {
			completed = true;
			return;
		}

		if (passCount < maxPasses) {
			task.schedule();
		}
	};

	const task = createPostPaintVirtualListTask(run, 2, getWindow);

	return {
		schedule() {
			if (completed || cancelledByScroll || task.isScheduled()) {
				return;
			}

			task.schedule();
		},
		cancel() {
			task.cancel();
		},
		cancelBecauseScrollStarted() {
			// A stable first pass already warmed the scroll-window gate. Preserve it
			// instead of turning the scroll-start cancellation into invalidation.
			if (
				measurement.hasStableScrollMetrics &&
				measurement.hasStableVisibleRange
			) {
				completed = true;
				task.cancel();
				return;
			}

			cancelledByScroll = true;
			task.cancel();
		},
	};
}
