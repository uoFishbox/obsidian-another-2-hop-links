import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	markScrollActivityActive,
	markScrollActivityIdle,
	resetScrollActivityForTests,
} from "infrastructure/scroll/scrollActivity";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import {
	disposePreviewDomCommitScheduler,
	enqueuePreviewDomCommit,
	resetPreviewDomCommitSchedulerForTests,
} from "../previewDomCommitScheduler";
import type { VirtualFrameCoordinator } from "ui/virtualization/frameCoordinator";

const scrollSource = {};
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;
let frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
let frameTimestamp = 0;

async function flushAnimationFrame(): Promise<void> {
	await vi.advanceTimersByTimeAsync(frameIntervalMs);
	await Promise.resolve();
}

interface EnqueueTestCommitOptions {
	readonly targetKey: string;
	readonly isStale?: () => boolean;
	readonly didMutateDom?: boolean;
	readonly onCommit?: () => void;
}

function enqueueTestCommit(options: EnqueueTestCommitOptions): Promise<boolean> {
	return enqueuePreviewDomCommit({
		targetKey: options.targetKey,
		isStale: options.isStale ?? (() => false),
		commit: () => {
			options.onCommit?.();
			return options.didMutateDom ?? true;
		},
	});
}

async function countCommits(params: {
	readonly intervalMs: number;
	readonly durationMs: number;
	readonly scrolling: boolean;
}): Promise<number> {
	resetPreviewDomCommitSchedulerForTests();
	resetScrollActivityForTests();
	frameIntervalMs = params.intervalMs;
	let committed = 0;

	if (params.scrolling) {
		markScrollActivityActive(scrollSource);
	}
	for (let index = 0; index < 500; index += 1) {
		void enqueueTestCommit({
			targetKey: `preview-${index}`,
			onCommit: () => {
				committed += 1;
			},
		});
	}

	await vi.advanceTimersByTimeAsync(params.durationMs);
	return committed;
}

beforeEach(() => {
	frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
	frameTimestamp = 0;
	resetCCLDevMeasurements();
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) =>
			setTimeout(() => {
				frameTimestamp += frameIntervalMs;
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
	resetCCLDevMeasurements();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("preview DOM commit scheduler", () => {
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

	it("holds DOM commits and animation-frame work until scrolling becomes idle", async () => {
		markScrollActivityActive(scrollSource);
		const committed: string[] = [];

		const commits = ["a", "b", "c"].map((key) =>
			enqueueTestCommit({
				targetKey: key,
				onCommit: () => committed.push(key),
			}),
		);

		await vi.advanceTimersByTimeAsync(1_000);
		expect(committed).toEqual([]);
		expect(requestAnimationFrame).not.toHaveBeenCalled();
		let counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["preview.domCommitScheduler.animationFrame"].count).toBe(0);
		expect(counters["preview.domCommitDuringScroll"].count).toBe(0);

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		expect(committed).toEqual(["a", "b", "c"]);
		counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["preview.domCommitScheduler.animationFrame"].count).toBe(1);
		await expect(Promise.all(commits)).resolves.toEqual([true, true, true]);
	});

	it("delegates idle DOM commits to the surface frame coordinator", async () => {
		let idleTask: (() => void) | undefined;
		const frameCoordinator: VirtualFrameCoordinator = {
			schedule: vi.fn((_lane, _key, task) => {
				idleTask = task;
				return true;
			}),
			cancel: vi.fn(),
			isScheduled: vi.fn(() => false),
			dispose: vi.fn(),
		};
		const commit = enqueuePreviewDomCommit({
			targetKey: "preview-coordinated",
			isStale: () => false,
			commit: () => true,
			frameCoordinator,
		});

		expect(frameCoordinator.schedule).toHaveBeenCalledWith(
			"idle",
			"preview:dom-commit-drain",
			expect.any(Function),
		);
		expect(requestAnimationFrame).not.toHaveBeenCalled();
		idleTask?.();

		await expect(commit).resolves.toBe(true);
		expect(requestAnimationFrame).not.toHaveBeenCalled();
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

	it("suppresses scrolling DOM commits independently of refresh rate", async () => {
		const commitsAt60Hz = await countCommits({
			intervalMs: 1000 / 60,
			durationMs: 1000,
			scrolling: true,
		});
		const commitsAt120Hz = await countCommits({
			intervalMs: 1000 / 120,
			durationMs: 1000,
			scrolling: true,
		});

		expect(commitsAt60Hz).toBe(0);
		expect(commitsAt120Hz).toBe(0);
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

	it("does not commit after a long scrolling frame gap", async () => {
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
		expect(committed).toEqual([]);

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
});
