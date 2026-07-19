import { describe, expect, it, vi } from "vitest";
import {
	createEnrichmentScheduler,
	type EnrichmentRunContext,
} from "../enrichmentScheduler";

interface TestCandidate {
	readonly key: string;
	readonly generation: number;
	readonly priority: number;
	readonly opportunistic: boolean;
}

interface Deferred {
	readonly promise: Promise<void>;
	readonly resolve: () => void;
}

function createDeferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

function candidate(
	key: string,
	priority: number,
	generation = 1,
	opportunistic = false,
): TestCandidate {
	return { key, priority, generation, opportunistic };
}

describe("enrichmentScheduler", () => {
	it("prioritizes the visible center and waits for settlement before starting more work", async () => {
		let timestamp = 0;
		let timerCallback: (() => void) | undefined;
		const timerDelays: number[] = [];
		const deferredByKey = new Map<string, Deferred>();
		const started: string[] = [];
		const scheduler = createEnrichmentScheduler<TestCandidate>({
			getKey: (item) => item.key,
			getGenerationToken: (item) => item.generation,
			getPriority: (item) => item.priority,
			canStart: (_item, lane) => lane === "visible-idle",
			enrich: (item) => {
				started.push(item.key);
				const deferred = createDeferred();
				deferredByKey.set(item.key, deferred);
				return deferred.promise;
			},
			now: () => timestamp,
			setTimer: (callback, delayMs) => {
				timerCallback = callback;
				timerDelays.push(delayMs);
				return 1;
			},
			clearTimer: () => {},
		});

		scheduler.setCandidates([
			candidate("edge", 4),
			candidate("center", 0),
			candidate("near", 1),
		]);
		expect(started).toEqual([]);
		expect(timerDelays).toEqual([90]);

		timestamp = 90;
		timerCallback?.();
		expect(started).toEqual(["center", "near"]);
		expect(timerDelays).toEqual([90]);

		deferredByKey.get("center")?.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(started).toEqual(["center", "near", "edge"]);
		expect(timerDelays).toEqual([90]);
		scheduler.dispose();
	});

	it("aborts a running generation before starting its replacement", async () => {
		let timerCallback: (() => void) | undefined;
		const runs: Array<{
			readonly item: TestCandidate;
			readonly context: EnrichmentRunContext;
			readonly deferred: Deferred;
		}> = [];
		const scheduler = createEnrichmentScheduler<TestCandidate>({
			getKey: (item) => item.key,
			getGenerationToken: (item) => item.generation,
			getPriority: (item) => item.priority,
			canStart: (_item, lane) => lane === "visible-idle",
			enrich: (item, context) => {
				const deferred = createDeferred();
				runs.push({ item, context, deferred });
				return deferred.promise;
			},
			maxConcurrent: 1,
			idleDelayMs: 0,
			setTimer: (callback) => {
				timerCallback = callback;
				return 1;
			},
			clearTimer: () => {},
		});

		scheduler.setCandidates([candidate("slot", 0, 1)]);
		timerCallback?.();
		expect(runs).toHaveLength(1);
		expect(runs[0].context.isCurrent()).toBe(true);

		scheduler.setCandidates([candidate("slot", 0, 2)]);
		expect(runs[0].context.signal.aborted).toBe(true);
		expect(runs[0].context.isCurrent()).toBe(false);

		runs[0].deferred.resolve();
		await Promise.resolve();
		await Promise.resolve();
		timerCallback?.();
		expect(runs.map((run) => run.item.generation)).toEqual([1, 2]);
		scheduler.dispose();
	});

	it("invalidates keys and suspends all running enrichment while inactive", () => {
		let timerCallback: (() => void) | undefined;
		const signals = new Map<string, AbortSignal>();
		const scheduler = createEnrichmentScheduler<TestCandidate>({
			getKey: (item) => item.key,
			getGenerationToken: (item) => item.generation,
			getPriority: (item) => item.priority,
			canStart: (_item, lane) => lane === "visible-idle",
			enrich: (item, context) => {
				signals.set(item.key, context.signal);
				return new Promise(() => {});
			},
			idleDelayMs: 0,
			setTimer: (callback) => {
				timerCallback = callback;
				return 1;
			},
			clearTimer: vi.fn(),
		});

		scheduler.setCandidates([candidate("a", 0), candidate("b", 1)]);
		timerCallback?.();
		scheduler.invalidateKeys(new Set(["a"]));
		expect(signals.get("a")?.aborted).toBe(true);
		expect(signals.get("b")?.aborted).toBe(false);

		scheduler.setActive(false);
		expect(signals.get("b")?.aborted).toBe(true);
		scheduler.dispose();
	});

	it("uses the opportunistic lane at the configured interval", async () => {
		let timestamp = 200;
		const started: string[] = [];
		const scheduler = createEnrichmentScheduler<TestCandidate>({
			getKey: (item) => item.key,
			getGenerationToken: (item) => item.generation,
			getPriority: (item) => item.priority,
			canStart: (item, lane) => lane === "visible-idle" || item.opportunistic,
			enrich: async (item) => {
				started.push(item.key);
			},
			now: () => timestamp,
			setTimer: () => 1,
			clearTimer: () => {},
			opportunisticIntervalMs: 160,
		});

		scheduler.setCandidates([
			candidate("first", 0, 1, true),
			candidate("second", 1, 1, true),
		]);
		await Promise.resolve();
		await Promise.resolve();
		expect(started).toEqual(["first"]);

		timestamp = 250;
		scheduler.setCandidates([
			candidate("first", 0, 1, true),
			candidate("second", 1, 1, true),
		]);
		expect(started).toEqual(["first"]);

		timestamp = 360;
		scheduler.setCandidates([
			candidate("first", 0, 1, true),
			candidate("second", 1, 1, true),
		]);
		expect(started).toEqual(["first", "second"]);
		scheduler.dispose();
	});
});
