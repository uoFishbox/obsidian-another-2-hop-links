const SAMPLE_CAPACITY = 12;
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;

export interface TwoHopFrameBudgetPolicy {
	/** Soft card-shell budget. An atomic row bind may consume past zero. */
	readonly maxShellBindsPerFrame: number;
	readonly budgetRatio: number;
	readonly minimumBudgetMs: number;
	readonly maximumBudgetMs: number;
}

export interface TwoHopFrameBudgetTracker {
	readonly frameIntervalMs: number;
	readonly deadline: number;
	beginFrame(timestamp: number): void;
	canBind(now: number): boolean;
	/** Consumes the number of resolved card shells bound by a completed row. */
	consumeBinds(count: number): void;
}

const DEFAULT_POLICY: TwoHopFrameBudgetPolicy = {
	maxShellBindsPerFrame: 12,
	budgetRatio: 0.3,
	minimumBudgetMs: 0.75,
	maximumBudgetMs: 3,
};

/** Tracks refresh cadence without allocating in the scroll frame. */
export function createTwoHopFrameBudgetTracker(
	policy: TwoHopFrameBudgetPolicy = DEFAULT_POLICY,
): TwoHopFrameBudgetTracker {
	const samples = new Float64Array(SAMPLE_CAPACITY);
	const orderedSamples = new Float64Array(SAMPLE_CAPACITY);
	let sampleCount = 0;
	let nextSampleIndex = 0;
	let lastFrameTimestamp = 0;
	let estimatedFrameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
	let deadline = 0;
	let remainingBinds = 0;

	function beginFrame(timestamp: number): void {
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
			Math.max(
				policy.minimumBudgetMs,
				estimatedFrameIntervalMs * policy.budgetRatio,
			),
		);
		remainingBinds = policy.maxShellBindsPerFrame;
		deadline = timestamp + duration;
	}

	function canBind(now: number): boolean {
		return remainingBinds > 0 && now <= deadline;
	}

	function consumeBinds(count: number): void {
		const normalizedCount = Number.isFinite(count)
			? Math.max(0, Math.floor(count))
			: 0;
		remainingBinds = Math.max(0, remainingBinds - normalizedCount);
	}

	return {
		beginFrame,
		canBind,
		consumeBinds,
		get frameIntervalMs() {
			return estimatedFrameIntervalMs;
		},
		get deadline() {
			return deadline;
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
	for (let index = 1; index < count; index += 1) {
		const value = orderedSamples[index];
		let insertionIndex = index;
		while (insertionIndex > 0 && orderedSamples[insertionIndex - 1] > value) {
			orderedSamples[insertionIndex] = orderedSamples[insertionIndex - 1];
			insertionIndex -= 1;
		}
		orderedSamples[insertionIndex] = value;
	}
	const middle = count >>> 1;
	return count % 2 === 0
		? (orderedSamples[middle - 1] + orderedSamples[middle]) / 2
		: orderedSamples[middle];
}
