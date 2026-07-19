export type EnrichmentLane = "visible-idle" | "scroll-opportunistic";

export interface EnrichmentScheduler<TCandidate> {
	/** Replaces the complete resident candidate snapshot. */
	setCandidates(candidates: readonly TCandidate[]): void;
	/** Suspends or resumes enrichment and aborts work when suspended. */
	setActive(active: boolean): void;
	/** Aborts and forgets the current generations for the supplied keys. */
	invalidateKeys(keys: ReadonlySet<string>): void;
	/** Aborts all work and permanently releases scheduler resources. */
	dispose(): void;
}

export interface EnrichmentRunContext {
	readonly signal: AbortSignal;
	readonly lane: EnrichmentLane;
	readonly generation: number;
	/** Returns false after invalidation, deactivation, replacement, or disposal. */
	readonly isCurrent: () => boolean;
}

export interface CreateEnrichmentSchedulerOptions<TCandidate> {
	/** Stable identity of the resident enrichment target. */
	readonly getKey: (candidate: TCandidate) => string;
	/** Changes whenever the target is rebound or its enrichment input changes. */
	readonly getGenerationToken: (candidate: TCandidate) => unknown;
	/** Lower values are started first. */
	readonly getPriority: (candidate: TCandidate) => number;
	readonly canStart: (candidate: TCandidate, lane: EnrichmentLane) => boolean;
	readonly enrich: (
		candidate: TCandidate,
		context: EnrichmentRunContext,
	) => Promise<void>;
	/** @default 2 */
	readonly maxConcurrent?: number;
	/** @default 90 */
	readonly idleDelayMs?: number;
	/** @default 160 */
	readonly opportunisticIntervalMs?: number;
	readonly now?: () => number;
	readonly setTimer?: (callback: () => void, delayMs: number) => number;
	readonly clearTimer?: (handle: number) => void;
	readonly onError?: (error: unknown, candidate: TCandidate) => void;
}

export const DEFAULT_ENRICHMENT_SCHEDULER_OPTIONS = {
	maxConcurrent: 2,
	idleDelayMs: 90,
	opportunisticIntervalMs: 160,
} as const;

interface CandidateRecord<TCandidate> {
	candidate: TCandidate;
	generationToken: unknown;
	generation: number;
	attemptedGeneration: number | null;
	order: number;
}

interface ActiveEnrichment<TCandidate> {
	readonly candidate: TCandidate;
	readonly generation: number;
	readonly abortController: AbortController;
}

/**
 * Creates a bounded scheduler for asynchronous enrichment of resident targets.
 * Candidate selection and work are injected so the scheduler remains independent
 * from preview rendering and virtualization.
 */
export function createEnrichmentScheduler<TCandidate>(
	options: CreateEnrichmentSchedulerOptions<TCandidate>,
): EnrichmentScheduler<TCandidate> {
	const maxConcurrent = normalizePositiveInteger(
		options.maxConcurrent ?? DEFAULT_ENRICHMENT_SCHEDULER_OPTIONS.maxConcurrent,
	);
	const idleDelayMs = normalizeDelay(
		options.idleDelayMs ?? DEFAULT_ENRICHMENT_SCHEDULER_OPTIONS.idleDelayMs,
	);
	const opportunisticIntervalMs = normalizeDelay(
		options.opportunisticIntervalMs ??
			DEFAULT_ENRICHMENT_SCHEDULER_OPTIONS.opportunisticIntervalMs,
	);
	const now = options.now ?? readMonotonicTime;
	const setTimer =
		options.setTimer ??
		((callback: () => void, delayMs: number) =>
			globalThis.setTimeout(callback, delayMs) as unknown as number);
	const clearTimer =
		options.clearTimer ?? ((handle: number) => globalThis.clearTimeout(handle));
	const candidatesByKey = new Map<string, CandidateRecord<TCandidate>>();
	const activeByKey = new Map<string, ActiveEnrichment<TCandidate>>();
	let candidateKeys: string[] = [];
	let nextGeneration = 1;
	let active = true;
	let disposed = false;
	let idleReady = false;
	let idleDeadline = 0;
	let idleTimer: number | null = null;
	let lastOpportunisticStartAt = Number.NEGATIVE_INFINITY;

	function setCandidates(candidates: readonly TCandidate[]): void {
		if (disposed) return;

		const nextKeys: string[] = [];
		const retainedKeys = new Set<string>();
		for (let order = 0; order < candidates.length; order += 1) {
			const candidate = candidates[order];
			const key = options.getKey(candidate);
			if (retainedKeys.has(key)) continue;
			retainedKeys.add(key);
			nextKeys.push(key);

			const generationToken = options.getGenerationToken(candidate);
			const current = candidatesByKey.get(key);
			if (current && Object.is(current.generationToken, generationToken)) {
				current.candidate = candidate;
				current.order = order;
				continue;
			}

			abortActiveKey(key);
			candidatesByKey.set(key, {
				candidate,
				generationToken,
				generation: nextGeneration,
				attemptedGeneration: null,
				order,
			});
			nextGeneration += 1;
		}

		for (const key of candidateKeys) {
			if (retainedKeys.has(key)) continue;
			abortActiveKey(key);
			candidatesByKey.delete(key);
		}
		candidateKeys = nextKeys;

		if (!active) return;
		scheduleIdleLane();
		startOpportunisticCandidate();
	}

	function setActive(nextActive: boolean): void {
		if (disposed || active === nextActive) return;
		active = nextActive;
		if (active) {
			scheduleIdleLane();
			return;
		}

		cancelIdleTimer();
		idleReady = false;
		for (const task of activeByKey.values()) {
			task.abortController.abort();
		}
		for (const record of candidatesByKey.values()) {
			record.generation = nextGeneration;
			record.attemptedGeneration = null;
			nextGeneration += 1;
		}
	}

	function invalidateKeys(keys: ReadonlySet<string>): void {
		if (disposed || keys.size === 0) return;

		for (const key of keys) {
			abortActiveKey(key);
			candidatesByKey.delete(key);
		}
		candidateKeys = candidateKeys.filter((key) => !keys.has(key));
	}

	function scheduleIdleLane(): void {
		idleReady = false;
		idleDeadline = now() + idleDelayMs;
		if (idleTimer !== null) return;
		idleTimer = setTimer(handleIdleTimer, idleDelayMs);
	}

	function handleIdleTimer(): void {
		if (disposed || !active) {
			idleTimer = null;
			return;
		}

		const remaining = idleDeadline - now();
		if (remaining > 0) {
			idleTimer = setTimer(handleIdleTimer, remaining);
			return;
		}

		idleTimer = null;
		idleReady = true;
		fillIdleCapacity();
	}

	function fillIdleCapacity(): void {
		if (disposed || !active || !idleReady) return;

		while (activeByKey.size < maxConcurrent) {
			const candidate = selectCandidate("visible-idle");
			if (!candidate) return;
			startCandidate(candidate.key, candidate.record, "visible-idle");
		}
	}

	function startOpportunisticCandidate(): void {
		if (disposed || !active || activeByKey.size >= maxConcurrent) return;
		const timestamp = now();
		if (timestamp - lastOpportunisticStartAt < opportunisticIntervalMs) {
			return;
		}

		const candidate = selectCandidate("scroll-opportunistic");
		if (!candidate) return;
		lastOpportunisticStartAt = timestamp;
		startCandidate(candidate.key, candidate.record, "scroll-opportunistic");
	}

	function selectCandidate(lane: EnrichmentLane): {
		readonly key: string;
		readonly record: CandidateRecord<TCandidate>;
	} | null {
		let bestKey: string | null = null;
		let bestRecord: CandidateRecord<TCandidate> | null = null;
		let bestPriority = Number.POSITIVE_INFINITY;

		for (const key of candidateKeys) {
			if (activeByKey.has(key)) continue;
			const record = candidatesByKey.get(key);
			if (!record || record.attemptedGeneration === record.generation) continue;
			if (!options.canStart(record.candidate, lane)) continue;

			const priority = normalizePriority(options.getPriority(record.candidate));
			if (
				bestRecord &&
				(priority > bestPriority ||
					(priority === bestPriority && record.order >= bestRecord.order))
			) {
				continue;
			}
			bestKey = key;
			bestRecord = record;
			bestPriority = priority;
		}

		return bestKey && bestRecord ? { key: bestKey, record: bestRecord } : null;
	}

	function startCandidate(
		key: string,
		record: CandidateRecord<TCandidate>,
		lane: EnrichmentLane,
	): void {
		const generation = record.generation;
		const abortController = new AbortController();
		const task: ActiveEnrichment<TCandidate> = {
			candidate: record.candidate,
			generation,
			abortController,
		};
		record.attemptedGeneration = generation;
		activeByKey.set(key, task);
		void runCandidate(key, task, lane);
	}

	async function runCandidate(
		key: string,
		task: ActiveEnrichment<TCandidate>,
		lane: EnrichmentLane,
	): Promise<void> {
		try {
			await options.enrich(task.candidate, {
				signal: task.abortController.signal,
				lane,
				generation: task.generation,
				isCurrent: () => isTaskCurrent(key, task),
			});
		} catch (error) {
			if (!task.abortController.signal.aborted) {
				if (options.onError) options.onError(error, task.candidate);
				else console.error("Enrichment task failed", error);
			}
		} finally {
			if (activeByKey.get(key) === task) {
				activeByKey.delete(key);
			}
			fillIdleCapacity();
		}
	}

	function isTaskCurrent(key: string, task: ActiveEnrichment<TCandidate>): boolean {
		if (disposed || !active || task.abortController.signal.aborted) return false;
		const record = candidatesByKey.get(key);
		return record?.generation === task.generation && activeByKey.get(key) === task;
	}

	function abortActiveKey(key: string): void {
		activeByKey.get(key)?.abortController.abort();
	}

	function cancelIdleTimer(): void {
		if (idleTimer === null) return;
		clearTimer(idleTimer);
		idleTimer = null;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		active = false;
		cancelIdleTimer();
		for (const task of activeByKey.values()) {
			task.abortController.abort();
		}
		candidatesByKey.clear();
		candidateKeys = [];
	}

	return { setCandidates, setActive, invalidateKeys, dispose };
}

function readMonotonicTime(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function normalizePositiveInteger(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.max(1, Math.floor(value));
}

function normalizeDelay(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, value);
}

function normalizePriority(value: number): number {
	return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}
