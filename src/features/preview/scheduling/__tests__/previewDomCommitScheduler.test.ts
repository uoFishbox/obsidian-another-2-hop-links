import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	markScrollActivityActive,
	markScrollActivityIdle,
	resetScrollActivityForTests,
} from "infrastructure/scroll/scrollActivity";
import {
	enqueuePreviewDomCommit,
	resetPreviewDomCommitSchedulerForTests,
} from "../previewDomCommitScheduler";

const scrollSource = {};
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;
let frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
let frameTimestamp = 0;

async function flushAnimationFrame(): Promise<void> {
	await vi.advanceTimersByTimeAsync(frameIntervalMs);
	await Promise.resolve();
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
		void enqueuePreviewDomCommit({
			key: `preview-${index}`,
			isStale: () => false,
			commit: () => {
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
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("preview DOM commit scheduler", () => {
	it("coalesces pending commits by key", async () => {
		const committed: string[] = [];

		const firstCommit = enqueuePreviewDomCommit({
			key: "preview-a",
			isStale: () => false,
			commit: () => committed.push("first"),
		});
		const secondCommit = enqueuePreviewDomCommit({
			key: "preview-a",
			isStale: () => false,
			commit: () => committed.push("second"),
		});

		await expect(firstCommit).resolves.toBe(false);

		await flushAnimationFrame();

		await expect(secondCommit).resolves.toBe(true);
		expect(committed).toEqual(["second"]);
	});

	it("limits scrolling commits by elapsed time", async () => {
		markScrollActivityActive(scrollSource);
		const committed: string[] = [];

		const commits = ["a", "b", "c"].map((key) =>
			enqueuePreviewDomCommit({
				key,
				isStale: () => false,
				commit: () => committed.push(key),
			}),
		);

		await flushAnimationFrame();
		expect(committed).toEqual(["a"]);

		await flushAnimationFrame();
		expect(committed).toEqual(["a", "b"]);

		await flushAnimationFrame();
		expect(committed).toEqual(["a", "b", "c"]);
		await expect(Promise.all(commits)).resolves.toEqual([true, true, true]);
	});

	it("allows an idle burst of four commits", async () => {
		const committed: string[] = [];

		const commits = ["a", "b", "c", "d", "e"].map((key) =>
			enqueuePreviewDomCommit({
				key,
				isStale: () => false,
				commit: () => committed.push(key),
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

	it("rate-limits scrolling commits independently of refresh rate", async () => {
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

		expect(Math.abs(commitsAt60Hz - commitsAt120Hz)).toBeLessThanOrEqual(1);
		expect(commitsAt60Hz).toBeGreaterThanOrEqual(59);
		expect(commitsAt60Hz).toBeLessThanOrEqual(63);
		expect(commitsAt120Hz).toBeGreaterThanOrEqual(59);
		expect(commitsAt120Hz).toBeLessThanOrEqual(63);
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

	it("does not accumulate an unbounded burst after a long frame gap", async () => {
		markScrollActivityActive(scrollSource);
		const committed: string[] = [];

		for (const key of ["a", "b", "c", "d"]) {
			void enqueuePreviewDomCommit({
				key,
				isStale: () => false,
				commit: () => committed.push(key),
			});
		}

		await flushAnimationFrame();
		expect(committed).toEqual(["a"]);

		frameIntervalMs = 5000;
		await flushAnimationFrame();
		expect(committed).toEqual(["a", "b"]);
	});

	it("skips stale commits without consuming time-budgeted capacity", async () => {
		const committed: string[] = [];

		const staleCommit = enqueuePreviewDomCommit({
			key: "stale",
			isStale: () => true,
			commit: () => committed.push("stale"),
		});
		const liveCommit = enqueuePreviewDomCommit({
			key: "live",
			isStale: () => false,
			commit: () => committed.push("live"),
		});

		await flushAnimationFrame();

		await expect(staleCommit).resolves.toBe(false);
		await expect(liveCommit).resolves.toBe(true);
		expect(committed).toEqual(["live"]);
	});

	it("uses the current scroll state when a frame drains", async () => {
		markScrollActivityActive(scrollSource);
		const committed: string[] = [];
		const commits: Promise<boolean>[] = [];

		for (const key of ["a", "b", "c", "d"]) {
			commits.push(
				enqueuePreviewDomCommit({
					key,
					isStale: () => false,
					commit: () => committed.push(key),
				}),
			);
		}

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();

		expect(committed).toEqual(["a", "b", "c", "d"]);
		await expect(Promise.all(commits)).resolves.toEqual([true, true, true, true]);
	});
});
