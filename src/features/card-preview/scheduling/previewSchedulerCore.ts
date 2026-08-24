import { subscribeScrollActivity } from "ui/shared/scroll/scrollActivity";
import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";
import {
	createPreviewFrameDriver,
	readPreviewSchedulingTime,
	type PreviewFrameDriver,
} from "./previewFrameDriver";
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

/**
 * Returns the delay before the next token can be consumed. The next scheduled
 * frame refills the bucket, so one frame interval is removed from the delay.
 */
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

/** Common part of a scheduler partition used by activation and DOM commits. */
export interface PreviewSchedulerPartitionBase {
	readonly coordinator: VirtualFrameCoordinator | undefined;
	readonly driver: PreviewFrameDriver;
}

/** Identity/driver registry shared by scheduler partition implementations. */
export interface PreviewSchedulerPartitionRegistry<
	TPartition extends PreviewSchedulerPartitionBase,
> {
	readonly fallbackPartitionIdentity: object;
	readonly partitionsByIdentity: Map<object, TPartition>;
	nextPartitionId: number;
}

/** Creates an empty partition registry for one scheduler instance. */
export function createPreviewSchedulerPartitionRegistry<
	TPartition extends PreviewSchedulerPartitionBase,
>(): PreviewSchedulerPartitionRegistry<TPartition> {
	return {
		fallbackPartitionIdentity: {},
		partitionsByIdentity: new Map(),
		nextPartitionId: 0,
	};
}

export interface CreatePreviewSchedulerPartitionOptions<
	TPartition extends PreviewSchedulerPartitionBase,
> {
	readonly coordinator: VirtualFrameCoordinator | undefined;
	readonly taskKeyPrefix: string;
	readonly getWindow?: () => Window | null;
	readonly createPartition: (
		driver: PreviewFrameDriver,
		coordinator: VirtualFrameCoordinator | undefined,
	) => TPartition;
	readonly onFrame: (partition: TPartition, timestamp: number) => void;
}

/**
 * Gets or creates the coordinator-isolated partition used by a scheduler.
 * The partition-specific queue and policy remain owned by the caller.
 */
export function getOrCreatePreviewSchedulerPartition<
	TPartition extends PreviewSchedulerPartitionBase,
>(
	registry: PreviewSchedulerPartitionRegistry<TPartition>,
	options: CreatePreviewSchedulerPartitionOptions<TPartition>,
): TPartition {
	const identity = options.coordinator ?? registry.fallbackPartitionIdentity;
	const existing = registry.partitionsByIdentity.get(identity);
	if (existing) return existing;

	let partition: TPartition | undefined;
	const taskKey = `${options.taskKeyPrefix}:${++registry.nextPartitionId}`;
	const driver = createPreviewFrameDriver({
		coordinator: options.coordinator,
		taskKey,
		getWindow: options.getWindow,
		onFrame: (timestamp) => {
			if (partition) options.onFrame(partition, timestamp);
		},
	});
	partition = options.createPartition(driver, options.coordinator);
	registry.partitionsByIdentity.set(identity, partition);
	return partition;
}

/** Reads the current scheduling clock for callers that need local deadlines. */
export { readPreviewSchedulingTime };
