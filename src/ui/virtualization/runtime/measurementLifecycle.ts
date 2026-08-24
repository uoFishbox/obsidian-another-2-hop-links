import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";
import type {
	MountedScrollWindowMeasurement,
	RangedScrollWindowMeasurement,
	StableScrollTopBand,
} from "../engine/scrollWindowResolver";
import type {
	ScrollMeasurementRange,
	VirtualViewportObservation,
	VirtualScrollMeasurementReason,
} from "../viewport/observer/scrollMeasurement";
import type { VirtualListSharedScrollMetrics } from "../viewport/measurement";

export type { VirtualScrollMeasurementReason } from "../viewport/observer/scrollMeasurement";

export type VirtualMeasurementSource = "layout" | "scroll";

export interface VirtualMeasurement {
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly sectionTop: number;
	readonly isStableMeasurement: boolean;
	readonly isScrollActive: boolean;
	/** Observer scroll generation represented by this measurement. */
	readonly scrollGeneration: number;
	readonly source: VirtualMeasurementSource;
	readonly sectionRect?: DOMRect;
	readonly sharedScrollMetrics?: VirtualListSharedScrollMetrics;
}

export type VirtualMeasurementResult =
	| { readonly kind: "measured"; readonly measurement: VirtualMeasurement }
	| {
			readonly kind: "skipped";
			readonly reason: "no-root" | "no-window" | "unchanged-scroll";
	  };

export type VirtualMeasurementApplicationResult = "stable" | "unstable" | "skipped";

export interface VirtualListStableMeasurementContext {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isScrollActive: boolean;
	sharedScrollMetrics?: VirtualListSharedScrollMetrics;
}

export interface RunVirtualScrollMeasurementOptions {
	/**
	 * Publish even when the cached scroll geometry matches the last stable
	 * measurement. Use this when non-scroll inputs, such as row data, changed.
	 */
	forcePublish?: boolean;
	/** Dev-only reason for measurement classification. */
	reason?: VirtualScrollMeasurementReason;
}

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

export interface InitialMeasurementLifecycle {
	suppressForBootstrap(): void;
	scheduleObservedLayoutMeasurement(): void;
	scheduleStabilization(): void;
	cancelBecauseScrollStarted(): void;
	/** Starts a fresh lifecycle for a newly bound observation. */
	resetForObservation(): void;
	/** Stops pending work without changing the completed/cancelled state. */
	cancel(): void;
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
}: InitialMeasurementLifecycleOptions): InitialMeasurementLifecycle {
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
		resetForObservation(): void {
			cancelObservedLayoutSuppression();
			cancelStabilization();
			passCount = 0;
			completed = false;
			cancelledByScroll = false;
			remainingFrames = 0;
		},
		cancel(): void {
			cancelObservedLayoutSuppression();
			cancelStabilization();
		},
	};
}

const MEASUREMENT_LANE = "scroll-critical" as const;
const LAYOUT_MEASUREMENT_TASK_KEY = "virtual-list:layout-measurement";
const SCROLL_MEASUREMENT_TASK_KEY = "virtual-list:scroll-measurement";
const UNSTABLE_MEASUREMENT_TASK_KEY = "virtual-list:unstable-measurement";

export interface VirtualMeasurementScheduler {
	hasPendingLayoutMeasurement(): boolean;
	scheduleLayoutMeasurement(): void;
	scheduleScrollMeasurement(task?: () => void): void;
	scheduleUnstableMeasurementRetry(): void;
	resetUnstableMeasurementRetry(): void;
	/** Cancels old work and restores retry capacity for a new observation. */
	resetForObservation(): void;
	cancelAll(): void;
}

export interface CreateVirtualMeasurementSchedulerOptions {
	frameCoordinator: VirtualFrameCoordinator;
	hasSchedulingWindow(): boolean;
	runLayoutMeasurement(): void;
	runScrollMeasurement(): void;
	unstableMeasurementRetryLimit: number;
}

/**
 * Owns measurement task priority, deduplication, cancellation, and unstable
 * layout retries. Measurement computation remains owned by the runtime.
 */
export function createVirtualMeasurementScheduler({
	frameCoordinator,
	hasSchedulingWindow,
	runLayoutMeasurement,
	runScrollMeasurement,
	unstableMeasurementRetryLimit,
}: CreateVirtualMeasurementSchedulerOptions): VirtualMeasurementScheduler {
	let unstableMeasurementRetryCount = 0;
	let pendingScrollMeasurementTask: (() => void) | undefined;

	const hasPendingLayoutMeasurement = (): boolean =>
		frameCoordinator.isScheduled(MEASUREMENT_LANE, LAYOUT_MEASUREMENT_TASK_KEY) ||
		frameCoordinator.isScheduled(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);

	const scheduleLayoutMeasurement = (): void => {
		if (
			!hasSchedulingWindow() ||
			frameCoordinator.isScheduled(MEASUREMENT_LANE, LAYOUT_MEASUREMENT_TASK_KEY)
		) {
			return;
		}

		frameCoordinator.cancel(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);
		frameCoordinator.cancel(MEASUREMENT_LANE, SCROLL_MEASUREMENT_TASK_KEY);
		frameCoordinator.schedule(
			MEASUREMENT_LANE,
			LAYOUT_MEASUREMENT_TASK_KEY,
			runLayoutMeasurement,
		);
	};

	const runScheduledScrollMeasurement = (): void => {
		const task = pendingScrollMeasurementTask ?? runScrollMeasurement;
		pendingScrollMeasurementTask = undefined;
		task();
	};

	const scheduleScrollMeasurement = (task?: () => void): void => {
		if (task) {
			pendingScrollMeasurementTask = task;
		}
		if (
			!hasSchedulingWindow() ||
			hasPendingLayoutMeasurement() ||
			frameCoordinator.isScheduled(MEASUREMENT_LANE, SCROLL_MEASUREMENT_TASK_KEY)
		) {
			return;
		}

		frameCoordinator.schedule(
			MEASUREMENT_LANE,
			SCROLL_MEASUREMENT_TASK_KEY,
			runScheduledScrollMeasurement,
		);
	};

	const runUnstableMeasurementRetry = (): void => {
		unstableMeasurementRetryCount += 1;
		runLayoutMeasurement();
	};

	const scheduleUnstableMeasurementRetry = (): void => {
		if (
			!hasSchedulingWindow() ||
			frameCoordinator.isScheduled(
				MEASUREMENT_LANE,
				UNSTABLE_MEASUREMENT_TASK_KEY,
			) ||
			unstableMeasurementRetryCount >= unstableMeasurementRetryLimit
		) {
			return;
		}

		frameCoordinator.schedule(
			MEASUREMENT_LANE,
			UNSTABLE_MEASUREMENT_TASK_KEY,
			runUnstableMeasurementRetry,
		);
	};

	const resetUnstableMeasurementRetry = (): void => {
		frameCoordinator.cancel(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);
		unstableMeasurementRetryCount = 0;
	};

	const cancelAll = (): void => {
		frameCoordinator.cancel(MEASUREMENT_LANE, LAYOUT_MEASUREMENT_TASK_KEY);
		frameCoordinator.cancel(MEASUREMENT_LANE, SCROLL_MEASUREMENT_TASK_KEY);
		frameCoordinator.cancel(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);
		pendingScrollMeasurementTask = undefined;
	};

	const resetForObservation = (): void => {
		cancelAll();
		unstableMeasurementRetryCount = 0;
	};

	return {
		hasPendingLayoutMeasurement,
		scheduleLayoutMeasurement,
		scheduleScrollMeasurement,
		scheduleUnstableMeasurementRetry,
		resetUnstableMeasurementRetry,
		resetForObservation,
		cancelAll,
	};
}

export interface VirtualScrollCoverageController {
	setObservation(observation: VirtualViewportObservation | null): void;
	clearObservation(observation: VirtualViewportObservation): void;
	setCoverageBand(coverageBand?: StableScrollTopBand): void;
	reset(): void;
	resolvePublishedCoverageBand(
		mountedMeasurement: MountedScrollWindowMeasurement,
		rangedMeasurement: RangedScrollWindowMeasurement,
	): StableScrollTopBand | undefined;
	getMeasurementRange(): ScrollMeasurementRange | null;
	publish(): void;
}

/** Owns the open scroll interval already covered by the published snapshot. */
export function createVirtualScrollCoverageController(): VirtualScrollCoverageController {
	let coverageScrollTopMin = Number.POSITIVE_INFINITY;
	let coverageScrollTopMax = Number.NEGATIVE_INFINITY;
	let observation: VirtualViewportObservation | null = null;
	const measurementRange: {
		-readonly [K in keyof ScrollMeasurementRange]: ScrollMeasurementRange[K];
	} = {
		minScrollTopBeforeMeasurement: 0,
		maxScrollTopBeforeMeasurement: 0,
	};
	const intersectionBand: {
		-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
	} = {
		min: 0,
		max: 0,
	};

	function setObservation(nextObservation: VirtualViewportObservation | null): void {
		observation = nextObservation;
	}

	function clearObservation(previousObservation: VirtualViewportObservation): void {
		if (observation === previousObservation) observation = null;
	}

	function setCoverageBand(coverageBand?: StableScrollTopBand): void {
		coverageScrollTopMin = coverageBand?.min ?? Number.POSITIVE_INFINITY;
		coverageScrollTopMax = coverageBand?.max ?? Number.NEGATIVE_INFINITY;
	}

	function reset(): void {
		setCoverageBand();
	}

	function resolvePublishedCoverageBand(
		mountedMeasurement: MountedScrollWindowMeasurement,
		rangedMeasurement: RangedScrollWindowMeasurement,
	): StableScrollTopBand | undefined {
		const mountedBand = mountedMeasurement.mountedCoverageScrollTopBand;
		const previewBand = rangedMeasurement.previewCoverageScrollTopBand;
		if (
			!mountedBand ||
			!previewBand ||
			mountedMeasurement.identity !== rangedMeasurement.identity ||
			mountedMeasurement.mounted.start !==
				rangedMeasurement.ranges.mounted.start ||
			mountedMeasurement.mounted.end !== rangedMeasurement.ranges.mounted.end ||
			rangedMeasurement.ranges.previewVisible.start <
				rangedMeasurement.ranges.mounted.start ||
			rangedMeasurement.ranges.previewVisible.end >
				rangedMeasurement.ranges.mounted.end
		) {
			return undefined;
		}

		intersectionBand.min = Math.max(mountedBand.min, previewBand.min);
		intersectionBand.max = Math.min(mountedBand.max, previewBand.max);
		return intersectionBand.min < intersectionBand.max
			? intersectionBand
			: undefined;
	}

	function getMeasurementRange(): ScrollMeasurementRange | null {
		if (!(coverageScrollTopMin < coverageScrollTopMax)) return null;

		measurementRange.minScrollTopBeforeMeasurement = coverageScrollTopMin;
		measurementRange.maxScrollTopBeforeMeasurement = coverageScrollTopMax;
		return measurementRange;
	}

	function publish(): void {
		observation?.publishScrollMeasurementRange(getMeasurementRange());
	}

	return {
		setObservation,
		clearObservation,
		setCoverageBand,
		reset,
		resolvePublishedCoverageBand,
		getMeasurementRange,
		publish,
	};
}

let measurementEpoch = 0;

/** Advances the generation whenever virtual scroll measurement work runs. */
export function markVirtualScrollMeasurementRun(): void {
	measurementEpoch += 1;
}

/** Returns the generation of the latest virtual scroll measurement. */
export function readVirtualScrollMeasurementEpoch(): number {
	return measurementEpoch;
}

/**
 * Reports whether preview activation should yield to measurement work that ran
 * since its partition last drained.
 */
export function shouldDeferPreviewActivationForVirtualScrollMeasurement(
	previouslyObservedEpoch: number,
): boolean {
	return measurementEpoch !== previouslyObservedEpoch;
}

export function resetVirtualScrollMeasurementFrameForTests(): void {
	measurementEpoch = 0;
}
