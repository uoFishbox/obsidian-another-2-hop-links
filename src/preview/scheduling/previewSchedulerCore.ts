import { subscribeScrollActivity } from "shared/ui/scroll/scrollActivity";
import { readPreviewSchedulingTime } from "./previewFrameDriver";
import {
	MAX_TOKEN_REFILL_ELAPSED_MS,
	readPreviewScheduleTokenDelayMs,
	type PreviewScheduleTokenState,
} from "./previewScheduleTokenBucket";

/** The frame interval used when a token becomes available between frames. */
export const EXPECTED_PREVIEW_FRAME_INTERVAL_MS = 1000 / 60;

/** Mutable scroll subscription state shared by preview scheduler facades. */
export interface PreviewScrollActivitySubscriptionState {
	unsubscribeScrollActivity?: () => void;
}

/** Resolves a configured rate while keeping invalid values from stalling a queue. */
export function resolvePositivePreviewRate(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Returns the delay before the next frame can consume a token. */
export function readPreviewTokenAvailabilityDelayMs(
	tokenState: PreviewScheduleTokenState,
	ratePerSecond: number,
): number {
	const availabilityDelayMs = readPreviewScheduleTokenDelayMs(
		tokenState,
		ratePerSecond,
	);
	return Math.min(
		MAX_TOKEN_REFILL_ELAPSED_MS,
		Math.max(0, availabilityDelayMs - EXPECTED_PREVIEW_FRAME_INTERVAL_MS),
	);
}

/** Installs one scroll activity listener for a scheduler while it has work. */
export function ensurePreviewScrollActivitySubscription(
	state: PreviewScrollActivitySubscriptionState,
	onActivityChange: (isActive: boolean) => void,
): void {
	if (state.unsubscribeScrollActivity) return;
	state.unsubscribeScrollActivity = subscribeScrollActivity(onActivityChange);
}

/** Releases the scroll activity listener once no queued work remains. */
export function releasePreviewScrollActivitySubscriptionIfIdle(
	state: PreviewScrollActivitySubscriptionState,
	hasPendingWork: boolean,
): void {
	if (hasPendingWork) return;
	state.unsubscribeScrollActivity?.();
	state.unsubscribeScrollActivity = undefined;
}

export { readPreviewSchedulingTime };
