const SAMPLE_CAPACITY = 12;
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;

export interface TwoHopFrameBudgetPolicy {
	readonly maxShellBindsPerFrame: number;
	readonly budgetRatio: number;
	readonly minimumBudgetMs: number;
	readonly maximumBudgetMs: number;
}

export interface TwoHopFrameBudget {
	readonly frameIntervalMs: number;
	readonly deadline: number;
	canBind(now: number): boolean;
	consumeBind(): void;
}

const DEFAULT_POLICY: TwoHopFrameBudgetPolicy = {
	maxShellBindsPerFrame: 8,
	budgetRatio: 0.2,
	minimumBudgetMs: 0.5,
	maximumBudgetMs: 3,
};

/** Tracks refresh cadence without allocating in the scroll frame. */
export function createTwoHopFrameBudgetTracker(
	policy: TwoHopFrameBudgetPolicy = DEFAULT_POLICY,
) {
	const samples = new Float64Array(SAMPLE_CAPACITY);
	const orderedSamples = new Float64Array(SAMPLE_CAPACITY);
	let sampleCount = 0;
	let nextSampleIndex = 0;
	let lastFrameTimestamp = 0;
	let estimatedFrameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;

	function beginFrame(timestamp: number): TwoHopFrameBudget {
		if (lastFrameTimestamp > 0) {
			const interval = timestamp - lastFrameTimestamp;
			if (interval > 0 && interval < 100) {
				samples[nextSampleIndex] = interval;
				nextSampleIndex = (nextSampleIndex + 1) % samples.length;
				sampleCount = Math.min(samples.length, sampleCount + 1);
				estimatedFrameIntervalMs = resolveMedian(
					samples,
					orderedSamples,
					sampleCount,
				);
			}
		}
		lastFrameTimestamp = timestamp;
		const duration = Math.min(
			policy.maximumBudgetMs,
			Math.max(policy.minimumBudgetMs, estimatedFrameIntervalMs * policy.budgetRatio),
		);
		let remainingBinds = policy.maxShellBindsPerFrame;
		const deadline = timestamp + duration;

		return {
			frameIntervalMs: estimatedFrameIntervalMs,
			deadline,
			canBind(now) {
				return remainingBinds > 0 && now <= deadline;
			},
			consumeBind() {
				remainingBinds = Math.max(0, remainingBinds - 1);
			},
		};
	}

	return {
		beginFrame,
		get estimatedFrameIntervalMs() {
			return estimatedFrameIntervalMs;
		},
	};
}

function resolveMedian(
	samples: Float64Array,
	orderedSamples: Float64Array,
	count: number,
): number {
	for (let index = 0; index < count; index += 1) {
		orderedSamples[index] = samples[index];
	}
	orderedSamples.subarray(0, count).sort();
	const middle = count >>> 1;
	return count % 2 === 0
		? (orderedSamples[middle - 1] + orderedSamples[middle]) / 2
		: orderedSamples[middle];
}

export type TwoHopFrameBudgetTracker = ReturnType<
	typeof createTwoHopFrameBudgetTracker
>;
