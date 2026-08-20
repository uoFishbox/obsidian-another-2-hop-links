import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";

const INITIAL_STABILIZATION_TASK_KEY = "virtual-list:initial-stabilization";

export interface InitialMeasurementLifecycleOptions {
	measurement: { readonly hasStableScrollMetrics: boolean };
	hasStableVisibleRange(): boolean;
	runLayoutMeasurement(): void;
	scheduleLayoutMeasurement(): void;
	getRootEl(): HTMLElement | null;
	getWindow(): Window | null;
	frameCoordinator: VirtualFrameCoordinator;
	maxPasses?: number;
}

export function createInitialMeasurementLifecycle({
	measurement,
	hasStableVisibleRange,
	runLayoutMeasurement,
	scheduleLayoutMeasurement,
	getRootEl,
	getWindow,
	frameCoordinator,
	maxPasses = 2,
}: InitialMeasurementLifecycleOptions) {
	let suppressObservedLayoutMeasurement = false;
	let observedLayoutSuppressionHandle: number | null = null;
	let passCount = 0;
	let completed = false;
	let cancelledByScroll = false;
	let remainingFrames = 0;

	const hasStableMeasurement = (): boolean =>
		measurement.hasStableScrollMetrics && hasStableVisibleRange();

	const releaseObservedLayoutSuppression = (): void => {
		suppressObservedLayoutMeasurement = false;
		observedLayoutSuppressionHandle = null;
	};

	const cancelObservedLayoutSuppression = (): void => {
		if (observedLayoutSuppressionHandle === null) return;
		const ownerWindow = getWindow();
		if (ownerWindow) {
			if (typeof ownerWindow.cancelAnimationFrame === "function") {
				ownerWindow.cancelAnimationFrame(observedLayoutSuppressionHandle);
			} else {
				ownerWindow.clearTimeout(observedLayoutSuppressionHandle);
			}
		}
		releaseObservedLayoutSuppression();
	};

	const runStabilizationPass = (): void => {
		if (completed || cancelledByScroll) return;
		if (hasStableMeasurement()) {
			completed = true;
			return;
		}
		if (!getRootEl() || !getWindow()) return;

		passCount += 1;
		runLayoutMeasurement();
		if (hasStableMeasurement()) {
			completed = true;
			return;
		}
		if (passCount < maxPasses) scheduleStabilization();
	};

	const advanceStabilizationFrame = (): void => {
		remainingFrames -= 1;
		if (remainingFrames > 0) {
			frameCoordinator.schedule(
				"animation-frame",
				INITIAL_STABILIZATION_TASK_KEY,
				advanceStabilizationFrame,
			);
			return;
		}
		runStabilizationPass();
	};

	function scheduleStabilization(): void {
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
		if (!ownerWindow) return;

		remainingFrames =
			typeof ownerWindow.requestAnimationFrame === "function" ? 2 : 1;
		frameCoordinator.schedule(
			"animation-frame",
			INITIAL_STABILIZATION_TASK_KEY,
			advanceStabilizationFrame,
		);
	}

	const cancelStabilization = (): void => {
		remainingFrames = 0;
		frameCoordinator.cancel("animation-frame", INITIAL_STABILIZATION_TASK_KEY);
	};

	return {
		suppressForBootstrap(): void {
			const ownerWindow = getWindow();
			if (!ownerWindow) return;
			cancelObservedLayoutSuppression();
			suppressObservedLayoutMeasurement = true;
			if (typeof ownerWindow.requestAnimationFrame === "function") {
				observedLayoutSuppressionHandle = ownerWindow.requestAnimationFrame(
					releaseObservedLayoutSuppression,
				);
				return;
			}
			observedLayoutSuppressionHandle = ownerWindow.setTimeout(
				releaseObservedLayoutSuppression,
				0,
			);
		},
		scheduleObservedLayoutMeasurement(): void {
			if (!suppressObservedLayoutMeasurement) scheduleLayoutMeasurement();
		},
		scheduleStabilization,
		cancelBecauseScrollStarted(): void {
			if (hasStableMeasurement()) {
				completed = true;
				cancelStabilization();
				return;
			}
			cancelledByScroll = true;
			cancelStabilization();
		},
		cancel(): void {
			cancelObservedLayoutSuppression();
			cancelStabilization();
		},
	};
}
