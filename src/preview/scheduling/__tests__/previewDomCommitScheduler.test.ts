import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	markScrollActivityActive,
	markScrollActivityIdle,
	resetScrollActivityForTests,
} from "shared/ui/scroll/scrollActivity";
import {
	createPreviewDomCommitScheduler,
	type PreviewDomCommitScope,
	type PreviewDomCommitTask,
} from "../previewDomCommitScheduler";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";

const scrollSource = {};
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;
let frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
let frameTimestamp = 0;
let frameTimeOrigin = 0;
let defaultTestScheduler = createPreviewDomCommitScheduler();
let defaultTestScope = defaultTestScheduler.createScope();

function enqueuePreviewDomCommit(task: PreviewDomCommitTask) {
	return defaultTestScope.schedule(task);
}

function disposePreviewDomCommitScheduler(): void {
	defaultTestScheduler.dispose();
}

function resetPreviewDomCommitSchedulerForTests(commitsPerSecond?: number): void {
	defaultTestScheduler.dispose();
	defaultTestScheduler = createPreviewDomCommitScheduler();
	defaultTestScope = createTestScope(commitsPerSecond);
}

async function flushAnimationFrame(): Promise<void> {
	await vi.advanceTimersByTimeAsync(frameIntervalMs);
	await vi.advanceTimersByTimeAsync(1);
	await Promise.resolve();
}

interface EnqueueTestCommitOptions {
	readonly targetKey: string;
	readonly isStale?: () => boolean;
	readonly didMutateDom?: boolean;
	readonly onCommit?: () => void;
}

function createTestScope(commitsPerSecond: number | undefined): PreviewDomCommitScope {
	return defaultTestScheduler.createScope({
		getCommitsPerSecond: commitsPerSecond ? () => commitsPerSecond : undefined,
	});
}

function enqueueTestCommit(options: EnqueueTestCommitOptions): Promise<boolean> {
	return enqueuePreviewDomCommit({
		targetKey: options.targetKey,
		isStale: options.isStale ?? (() => false),
		commit: () => {
			options.onCommit?.();
			return options.didMutateDom ?? true;
		},
	}).then((result) => result.type === "committed");
}

function createTestFrameCoordinator(scheduledTask: {
	current: (() => void) | undefined;
}): VirtualFrameCoordinator {
	return {
		schedule: vi.fn((_lane: string, _key: string, task: () => void) => {
			scheduledTask.current = task;
			return true;
		}),
		cancel: vi.fn(),
		isScheduled: vi.fn(() => false),
		dispose: vi.fn(),
	};
}

async function countCommits(params: {
	readonly intervalMs: number;
	readonly durationMs: number;
	readonly scrolling: boolean;
	readonly commitsPerSecond?: number;
}): Promise<number> {
	resetPreviewDomCommitSchedulerForTests(params.commitsPerSecond);
	resetScrollActivityForTests();
	frameIntervalMs = params.intervalMs;
	let committed = 0;

	if (params.scrolling) {
		markScrollActivityActive(scrollSource);
	}
	for (let index = 0; index < 500; index += 1) {
		void enqueuePreviewDomCommit({
			targetKey: `preview-${index}`,
			isStale: () => false,
			commit: () => {
				committed += 1;
				return true;
			},
		});
	}

	await vi.advanceTimersByTimeAsync(params.durationMs);
	return committed;
}

beforeEach(() => {
	frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
	frameTimestamp = 0;
	vi.useFakeTimers();
	frameTimeOrigin = Date.now();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) =>
			setTimeout(() => {
				frameTimestamp = Math.max(
					frameTimestamp + frameIntervalMs,
					Date.now() - frameTimeOrigin,
				);
				callback(frameTimestamp);
			}, frameIntervalMs),
		),
	);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
		clearTimeout(handle);
	});
});

afterEach(() => {
	resetPreviewDomCommitSchedulerForTests();
	resetScrollActivityForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("preview DOM commit scheduler", () => {
	it("disposes one scheduler instance without settling another instance", async () => {
		const first = createPreviewDomCommitScheduler();
		const second = createPreviewDomCommitScheduler();
		const firstScope = first.createScope();
		const secondScope = second.createScope();
		const firstCommit = vi.fn(() => true);
		const secondCommit = vi.fn(() => true);
		const firstResult = firstScope.schedule({
			targetKey: "shared-target",
			isStale: () => false,
			commit: firstCommit,
		});
		const secondResult = secondScope.schedule({
			targetKey: "shared-target",
			isStale: () => false,
			commit: secondCommit,
		});

		first.dispose();
		await expect(firstResult).resolves.toEqual({
			type: "skipped",
			reason: "disposed",
		});
		await flushAnimationFrame();
		await expect(secondResult).resolves.toEqual({ type: "committed" });
		expect(firstCommit).not.toHaveBeenCalled();
		expect(secondCommit).toHaveBeenCalledOnce();
		second.dispose();
	});

	it("skips work enqueued after disposal", async () => {
		const scheduler = createPreviewDomCommitScheduler();
		const commit = vi.fn(() => true);
		scheduler.dispose();

		const scope = scheduler.createScope();
		await expect(
			scope.schedule({
				targetKey: "disposed-target",
				isStale: () => false,
				commit,
			}),
		).resolves.toEqual({ type: "skipped", reason: "disposed" });
		expect(commit).not.toHaveBeenCalled();
	});

	it("coalesces pending commits by target key", async () => {
		const committed: string[] = [];

		const firstCommit = enqueueTestCommit({
			targetKey: "preview-a",
			onCommit: () => committed.push("first"),
		});
		const secondCommit = enqueueTestCommit({
			targetKey: "preview-a",
			onCommit: () => committed.push("second"),
		});

		await expect(firstCommit).resolves.toBe(false);

		await flushAnimationFrame();

		await expect(secondCommit).resolves.toBe(true);
		expect(committed).toEqual(["second"]);
	});

	it("does not let replaced work delay the latest target commit", async () => {
		const committed: string[] = [];
		const commits: Promise<boolean>[] = [];

		for (let revision = 0; revision < 300; revision += 1) {
			commits.push(
				enqueueTestCommit({
					targetKey: "preview-a",
					onCommit: () => committed.push(`old-${revision}`),
				}),
			);
		}

		const latestCommit = enqueueTestCommit({
			targetKey: "preview-a",
			onCommit: () => committed.push("latest"),
		});
		commits.push(latestCommit);

		await flushAnimationFrame();

		await expect(latestCommit).resolves.toBe(true);
		expect(committed).toEqual(["latest"]);
		await expect(Promise.all(commits.slice(0, -1))).resolves.toEqual(
			Array.from({ length: 300 }, () => false),
		);
	});

	it("commits previews sparsely while scrolling", async () => {
		markScrollActivityActive(scrollSource);
		const committed: string[] = [];

		const commits = Array.from({ length: 200 }, (_, index) =>
			enqueueTestCommit({
				targetKey: `preview-${index}`,
				onCommit: () => committed.push(`preview-${index}`),
			}),
		);

		await vi.advanceTimersByTimeAsync(1_000);
		expect(committed.length).toBeGreaterThanOrEqual(76);
		expect(committed.length).toBeLessThanOrEqual(79);
		const scrollingCommitCount = committed.length;
		const scrollingFrameCount = vi.mocked(requestAnimationFrame).mock.calls.length;

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		expect(committed.length).toBe(scrollingCommitCount + 4);
		expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBeGreaterThan(
			scrollingFrameCount,
		);
		disposePreviewDomCommitScheduler();
		await expect(Promise.all(commits)).resolves.toEqual(
			Array.from({ length: 200 }, (_, index) => index < committed.length),
		);
	});

	it("delegates idle DOM commits to the surface frame coordinator", async () => {
		const scheduledTask: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const frameCoordinator = createTestFrameCoordinator(scheduledTask);
		const scope = defaultTestScheduler.createScope({ frameCoordinator });
		const commit = scope.schedule({
			targetKey: "preview-coordinated",
			isStale: () => false,
			commit: () => true,
		});

		expect(frameCoordinator.schedule).toHaveBeenCalledWith(
			"idle",
			expect.stringMatching(/^preview:dom-commit-drain:/),
			expect.any(Function),
		);
		expect(requestAnimationFrame).not.toHaveBeenCalled();
		scheduledTask.current?.();

		await expect(commit).resolves.toEqual({ type: "committed" });
		expect(requestAnimationFrame).not.toHaveBeenCalled();
	});

	it("keeps coordinator partition state after its queue drains", async () => {
		const scheduledTask: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const frameCoordinator = createTestFrameCoordinator(scheduledTask);
		const scope = defaultTestScheduler.createScope({ frameCoordinator });

		const first = scope.schedule({
			targetKey: "preview-persistent-first",
			isStale: () => false,
			commit: () => true,
		});
		const firstDrainKey = vi.mocked(frameCoordinator.schedule).mock.calls[0]?.[1];
		scheduledTask.current?.();
		await expect(first).resolves.toEqual({ type: "committed" });

		const second = scope.schedule({
			targetKey: "preview-persistent-second",
			isStale: () => false,
			commit: () => true,
		});
		const secondDrainKey = vi.mocked(frameCoordinator.schedule).mock.calls[1]?.[1];
		expect(secondDrainKey).toBe(firstDrainKey);
		scheduledTask.current?.();
		await expect(second).resolves.toEqual({ type: "committed" });
	});

	it("delegates scrolling DOM commits to the post-paint lane", async () => {
		markScrollActivityActive(scrollSource);
		const scheduledTask: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const frameCoordinator = createTestFrameCoordinator(scheduledTask);
		const scope = defaultTestScheduler.createScope({ frameCoordinator });
		const commit = scope.schedule({
			targetKey: "preview-coordinated-scroll",
			isStale: () => false,
			commit: () => true,
		});

		expect(frameCoordinator.schedule).toHaveBeenCalledWith(
			"post-paint",
			expect.stringMatching(/^preview:dom-commit-drain:/),
			expect.any(Function),
		);
		scheduledTask.current?.();

		await expect(commit).resolves.toEqual({ type: "committed" });
	});

	it("does not immediately reschedule a scrolling partition only because its queue remains", () => {
		markScrollActivityActive(scrollSource);
		const scheduledTask: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const frameCoordinator = createTestFrameCoordinator(scheduledTask);
		const scope = defaultTestScheduler.createScope({ frameCoordinator });

		for (const key of ["a", "b"]) {
			void scope.schedule({
				targetKey: `preview-${key}`,
				isStale: () => false,
				commit: () => true,
			});
		}

		scheduledTask.current?.();
		expect(frameCoordinator.schedule).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(32);
		expect(frameCoordinator.schedule).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(2);
		expect(frameCoordinator.schedule).toHaveBeenCalledTimes(2);
	});

	it("waits until a low-rate scrolling token can be available", async () => {
		markScrollActivityActive(scrollSource);
		const scheduledTask: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const frameCoordinator = createTestFrameCoordinator(scheduledTask);
		const scope = defaultTestScheduler.createScope({
			frameCoordinator,
			getCommitsPerSecond: () => 1,
		});
		const first = scope.schedule({
			targetKey: "preview-low-rate-first",
			isStale: () => false,
			commit: () => true,
		});
		void scope.schedule({
			targetKey: "preview-low-rate-second",
			isStale: () => false,
			commit: () => true,
		});

		expect(frameCoordinator.schedule).toHaveBeenCalledOnce();
		scheduledTask.current?.();
		await expect(first).resolves.toEqual({ type: "committed" });
		expect(frameCoordinator.schedule).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(249);
		expect(frameCoordinator.schedule).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(2);
		expect(frameCoordinator.schedule).toHaveBeenCalledTimes(2);
	});

	it("commits during scrolling even when browser input is pending", async () => {
		markScrollActivityActive(scrollSource);
		const isInputPending = vi.fn(() => true);
		vi.stubGlobal("navigator", {
			scheduling: { isInputPending },
		});
		const scheduledTask: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const frameCoordinator = createTestFrameCoordinator(scheduledTask);
		const scope = defaultTestScheduler.createScope({ frameCoordinator });
		const commit = vi.fn(() => true);

		const result = scope.schedule({
			targetKey: "preview-input-pending",
			isStale: () => false,
			commit,
		});
		scheduledTask.current?.();

		await expect(result).resolves.toEqual({ type: "committed" });
		expect(commit).toHaveBeenCalledOnce();
		expect(isInputPending).not.toHaveBeenCalled();
	});

	it("allows an idle burst of four commits", async () => {
		const committed: string[] = [];

		const commits = ["a", "b", "c", "d", "e"].map((key) =>
			enqueueTestCommit({
				targetKey: key,
				onCommit: () => committed.push(key),
			}),
		);

		await flushAnimationFrame();
		expect(committed).toEqual(["a", "b", "c", "d"]);

		await flushAnimationFrame();
		expect(committed).toEqual(["a", "b", "c", "d", "e"]);
		await expect(Promise.all(commits)).resolves.toEqual([
			true,
			true,
			true,
			true,
			true,
		]);
	});

	it("clamps idle credit when scrolling starts", async () => {
		frameIntervalMs = 1_000;
		const committed: string[] = [];

		void enqueueTestCommit({
			targetKey: "idle",
			onCommit: () => {
				committed.push("idle");
				for (const key of ["a", "b", "c", "d"]) {
					void enqueueTestCommit({
						targetKey: key,
						onCommit: () => committed.push(key),
					});
				}
			},
		});

		await flushAnimationFrame();
		expect(committed).toEqual(["idle"]);

		markScrollActivityActive(scrollSource);
		await flushAnimationFrame();
		expect(committed).toEqual(["idle", "a"]);
	});

	it("rate-limits scrolling DOM commits independently of refresh rate", async () => {
		const commitsAt60Hz = await countCommits({
			intervalMs: 1000 / 60,
			durationMs: 5_000,
			scrolling: true,
		});
		const commitsAt120Hz = await countCommits({
			intervalMs: 1000 / 120,
			durationMs: 5_000,
			scrolling: true,
		});

		expect(Math.abs(commitsAt60Hz - commitsAt120Hz)).toBeLessThanOrEqual(2);
		expect(commitsAt60Hz).toBeGreaterThanOrEqual(392);
		expect(commitsAt60Hz).toBeLessThanOrEqual(401);
		expect(commitsAt120Hz).toBeGreaterThanOrEqual(392);
		expect(commitsAt120Hz).toBeLessThanOrEqual(401);
	});

	it("honors the configured commits-per-second limit", async () => {
		const committed = await countCommits({
			intervalMs: 1000 / 60,
			durationMs: 5_000,
			scrolling: true,
			commitsPerSecond: 39,
		});

		expect(committed).toBeGreaterThanOrEqual(192);
		expect(committed).toBeLessThanOrEqual(196);
	});

	it("preserves a very low configured commit rate", async () => {
		const committed = await countCommits({
			intervalMs: 1000 / 60,
			durationMs: 5_000,
			scrolling: true,
			commitsPerSecond: 1,
		});

		expect(committed).toBeGreaterThanOrEqual(5);
		expect(committed).toBeLessThanOrEqual(6);
	});

	it("rate-limits idle commits independently of refresh rate", async () => {
		const commitsAt60Hz = await countCommits({
			intervalMs: 1000 / 60,
			durationMs: 1000,
			scrolling: false,
		});
		const commitsAt120Hz = await countCommits({
			intervalMs: 1000 / 120,
			durationMs: 1000,
			scrolling: false,
		});

		expect(Math.abs(commitsAt60Hz - commitsAt120Hz)).toBeLessThanOrEqual(4);
		expect(commitsAt60Hz).toBeGreaterThanOrEqual(236);
		expect(commitsAt60Hz).toBeLessThanOrEqual(252);
		expect(commitsAt120Hz).toBeGreaterThanOrEqual(236);
		expect(commitsAt120Hz).toBeLessThanOrEqual(252);
	});

	it("does not burst after a long scrolling frame gap", async () => {
		markScrollActivityActive(scrollSource);
		const committed: string[] = [];

		for (const key of ["a", "b", "c", "d"]) {
			void enqueueTestCommit({
				targetKey: key,
				onCommit: () => committed.push(key),
			});
		}

		frameIntervalMs = 5000;
		await flushAnimationFrame();
		expect(committed).toEqual(["a"]);

		frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		expect(committed).toEqual(["a", "b", "c", "d"]);
	});

	it("skips stale commits without consuming token capacity", async () => {
		const committed: string[] = [];

		const staleCommit = enqueueTestCommit({
			targetKey: "stale",
			isStale: () => true,
			onCommit: () => committed.push("stale"),
		});
		const liveCommit = enqueueTestCommit({
			targetKey: "live",
			onCommit: () => committed.push("live"),
		});

		await flushAnimationFrame();

		await expect(staleCommit).resolves.toBe(false);
		await expect(liveCommit).resolves.toBe(true);
		expect(committed).toEqual(["live"]);
	});

	it("does not consume token capacity for no-op commits", async () => {
		const committed: string[] = [];

		const commits = ["noop-a", "noop-b", "noop-c", "noop-d"].map((key) =>
			enqueueTestCommit({
				targetKey: key,
				didMutateDom: false,
				onCommit: () => committed.push(key),
			}),
		);
		const liveCommit = enqueueTestCommit({
			targetKey: "live",
			onCommit: () => committed.push("live"),
		});

		await flushAnimationFrame();

		await expect(Promise.all(commits)).resolves.toEqual([
			false,
			false,
			false,
			false,
		]);
		await flushAnimationFrame();
		await expect(liveCommit).resolves.toBe(true);
		expect(committed).toEqual(["noop-a", "noop-b", "noop-c", "noop-d", "live"]);
	});

	it("uses the current scroll state when a frame drains", async () => {
		markScrollActivityActive(scrollSource);
		const committed: string[] = [];
		const commits: Promise<boolean>[] = [];

		for (const key of ["a", "b", "c", "d"]) {
			commits.push(
				enqueueTestCommit({
					targetKey: key,
					onCommit: () => committed.push(key),
				}),
			);
		}

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();

		expect(committed).toEqual(["a", "b", "c", "d"]);
		await expect(Promise.all(commits)).resolves.toEqual([true, true, true, true]);
	});

	it("uses a timeout fallback when requestAnimationFrame is unavailable", async () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		const commit = enqueueTestCommit({ targetKey: "fallback" });

		await vi.advanceTimersByTimeAsync(frameIntervalMs);

		await expect(commit).resolves.toBe(true);
	});

	it("settles pending commits when the scheduler is disposed", async () => {
		const commit = enqueueTestCommit({ targetKey: "disposed" });

		disposePreviewDomCommitScheduler();

		await expect(commit).resolves.toBe(false);
	});

	it("keeps coordinator drains isolated to their own surface", async () => {
		const firstScheduled: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const secondScheduled: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const firstCoordinator = createTestFrameCoordinator(firstScheduled);
		const secondCoordinator = createTestFrameCoordinator(secondScheduled);
		const firstScope = defaultTestScheduler.createScope({
			frameCoordinator: firstCoordinator,
		});
		const secondScope = defaultTestScheduler.createScope({
			frameCoordinator: secondCoordinator,
		});
		const committed: string[] = [];
		const first = firstScope.schedule({
			targetKey: "preview-first",
			isStale: () => false,
			commit: () => {
				committed.push("first");
				return true;
			},
		});
		const second = secondScope.schedule({
			targetKey: "preview-second",
			isStale: () => false,
			commit: () => {
				committed.push("second");
				return true;
			},
		});

		firstScheduled.current?.();
		await expect(first).resolves.toEqual({ type: "committed" });
		expect(committed).toEqual(["first"]);
		let secondSettled = false;
		void second.then(() => {
			secondSettled = true;
		});
		await Promise.resolve();
		expect(secondSettled).toBe(false);

		secondScheduled.current?.();
		await expect(second).resolves.toEqual({ type: "committed" });
		expect(committed).toEqual(["first", "second"]);
	});

	it("settles pending commits when its scope is disposed", async () => {
		const commit = enqueueTestCommit({ targetKey: "preview-pending" });

		defaultTestScope.dispose();

		await expect(commit).resolves.toBe(false);
	});

	it("does not settle another scope's pending commits", async () => {
		const firstScope = defaultTestScheduler.createScope();
		const secondScope = defaultTestScheduler.createScope();
		const firstCommit = firstScope.schedule({
			targetKey: "preview-disposed",
			isStale: () => false,
			commit: () => true,
		});
		const secondCommit = secondScope.schedule({
			targetKey: "preview-kept",
			isStale: () => false,
			commit: () => true,
		});

		firstScope.dispose();
		await expect(firstCommit).resolves.toEqual({
			type: "skipped",
			reason: "disposed",
		});
		await flushAnimationFrame();
		await expect(secondCommit).resolves.toEqual({ type: "committed" });
	});

	it("releases a coordinator partition when its last scope is disposed", async () => {
		const scheduledTask: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const frameCoordinator = createTestFrameCoordinator(scheduledTask);
		const firstScope = defaultTestScheduler.createScope({ frameCoordinator });
		firstScope.schedule({
			targetKey: "preview-released",
			isStale: () => false,
			commit: () => true,
		});
		const firstDrainKey = vi.mocked(frameCoordinator.schedule).mock.calls[0]?.[1];

		firstScope.dispose();
		expect(frameCoordinator.cancel).toHaveBeenCalled();

		const secondScope = defaultTestScheduler.createScope({ frameCoordinator });
		secondScope.schedule({
			targetKey: "preview-recreated",
			isStale: () => false,
			commit: () => true,
		});
		const secondDrainKey = vi.mocked(frameCoordinator.schedule).mock.calls[1]?.[1];
		expect(secondDrainKey).not.toBe(firstDrainKey);
	});

	it("keeps a shared coordinator partition alive while one scope remains", async () => {
		const scheduledTask: { current: (() => void) | undefined } = {
			current: undefined,
		};
		const frameCoordinator = createTestFrameCoordinator(scheduledTask);
		const firstScope = defaultTestScheduler.createScope({ frameCoordinator });
		const secondScope = defaultTestScheduler.createScope({ frameCoordinator });
		const first = firstScope.schedule({
			targetKey: "preview-disposed-first",
			isStale: () => false,
			commit: () => true,
		});
		const second = secondScope.schedule({
			targetKey: "preview-kept-second",
			isStale: () => false,
			commit: () => true,
		});
		const drainKey = vi.mocked(frameCoordinator.schedule).mock.calls[0]?.[1];

		firstScope.dispose();
		expect(frameCoordinator.cancel).not.toHaveBeenCalled();
		await expect(first).resolves.toEqual({
			type: "skipped",
			reason: "disposed",
		});

		scheduledTask.current?.();
		await expect(second).resolves.toEqual({ type: "committed" });

		const third = secondScope.schedule({
			targetKey: "preview-kept-third",
			isStale: () => false,
			commit: () => true,
		});
		const secondDrainKey = vi.mocked(frameCoordinator.schedule).mock.calls[1]?.[1];
		expect(secondDrainKey).toBe(drainKey);
		scheduledTask.current?.();
		await expect(third).resolves.toEqual({ type: "committed" });
	});

	it("releases the fallback partition when its last scope is disposed", async () => {
		enqueueTestCommit({ targetKey: "preview-fallback" });
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		defaultTestScope.dispose();
		await flushAnimationFrame();
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		const recreatedScope = defaultTestScheduler.createScope();
		recreatedScope.schedule({
			targetKey: "preview-recreated-fallback",
			isStale: () => false,
			commit: () => true,
		});
		expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
	});

	it("reports why a DOM commit was skipped", async () => {
		const first = enqueuePreviewDomCommit({
			targetKey: "preview-replaced",
			isStale: () => false,
			commit: () => true,
		});
		const replacement = enqueuePreviewDomCommit({
			targetKey: "preview-replaced",
			isStale: () => true,
			commit: () => true,
		});

		await expect(first).resolves.toEqual({
			type: "skipped",
			reason: "replaced",
		});
		await flushAnimationFrame();
		await expect(replacement).resolves.toEqual({
			type: "skipped",
			reason: "stale",
		});
	});
});
