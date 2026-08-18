import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import type { VirtualListMeasurementStateHandle } from "./virtualListMeasurementState";

export interface InitialVirtualListStabilizationOptions {
	measurement: VirtualListMeasurementStateHandle;
	runLayoutMeasurement: () => void;
	getRootEl: () => HTMLElement | null;
	getWindow: () => Window | null;
	frameCoordinator: VirtualFrameCoordinator;
	maxPasses?: number;
}

export interface InitialVirtualListStabilization {
	schedule(): void;
	cancel(): void;
	cancelBecauseScrollStarted(): void;
}

const INITIAL_STABILIZATION_TASK_KEY = "virtual-list:initial-stabilization";

export function createInitialVirtualListStabilization({
	measurement,
	runLayoutMeasurement,
	getRootEl,
	getWindow,
	frameCoordinator,
	maxPasses = 2,
}: InitialVirtualListStabilizationOptions): InitialVirtualListStabilization {
	let passCount = 0;
	let completed = false;
	let cancelledByScroll = false;
	let remainingFrames = 0;

	const hasStableMeasurement = (): boolean =>
		measurement.hasStableScrollMetrics && measurement.hasStableVisibleRange;

	const run = () => {
		if (completed || cancelledByScroll) {
			return;
		}

		if (hasStableMeasurement()) {
			completed = true;
			return;
		}

		const rootEl = getRootEl();
		if (!rootEl || !getWindow()) {
			return;
		}

		passCount += 1;
		runLayoutMeasurement();

		if (hasStableMeasurement()) {
			completed = true;
			return;
		}

		if (passCount < maxPasses) {
			schedule();
		}
	};

	const advanceFrame = (): void => {
		remainingFrames -= 1;
		if (remainingFrames > 0) {
			frameCoordinator.schedule(
				"animation-frame",
				INITIAL_STABILIZATION_TASK_KEY,
				advanceFrame,
			);
			return;
		}
		run();
	};

	function schedule(): void {
		if (
			completed ||
			cancelledByScroll ||
			frameCoordinator.isScheduled(
				"animation-frame",
				INITIAL_STABILIZATION_TASK_KEY,
			)
		) {
			return;
		}

		if (hasStableMeasurement()) {
			completed = true;
			return;
		}
		const ownerWindow = getWindow();
		if (!ownerWindow) {
			return;
		}

		// Preserve the legacy scheduler: double rAF in browsers, one macrotask
		// fallback when requestAnimationFrame is unavailable.
		remainingFrames =
			typeof ownerWindow.requestAnimationFrame === "function" ? 2 : 1;
		frameCoordinator.schedule(
			"animation-frame",
			INITIAL_STABILIZATION_TASK_KEY,
			advanceFrame,
		);
	}

	function cancel(): void {
		remainingFrames = 0;
		frameCoordinator.cancel("animation-frame", INITIAL_STABILIZATION_TASK_KEY);
	}

	return {
		schedule,
		cancel,
		cancelBecauseScrollStarted() {
			// A stable first pass already warmed the scroll-window gate. Preserve it
			// instead of turning the scroll-start cancellation into invalidation.
			if (hasStableMeasurement()) {
				completed = true;
				cancel();
				return;
			}

			cancelledByScroll = true;
			cancel();
		},
	};
}
