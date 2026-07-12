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

interface EnqueueTestCommitOptions {
	readonly targetKey: string;
	readonly revisionKey?: string;
	readonly isStale?: () => boolean;
	readonly didMutateDom?: boolean;
	readonly onCommit?: () => void;
}

function enqueueTestCommit(options: EnqueueTestCommitOptions): Promise<boolean> {
	return enqueuePreviewDomCommit({
		targetKey: options.targetKey,
		revisionKey: options.revisionKey ?? options.targetKey,
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
	it("coalesces pending commits by target key", async () => {
		const committed: string[] = [];

		const firstCommit = enqueueTestCommit({
			targetKey: "preview-a",
			revisionKey: "old",
			onCommit: () => committed.push("first"),
		});
		const secondCommit = enqueueTestCommit({
			targetKey: "preview-a",
			revisionKey: "new",
			onCommit: () => committed.push("second"),
		});

		await expect(firstCommit).resolves.toBe(false);

		await flushAnimationFrame();

		await expect(secondCommit).resolves.toBe(true);
		expect(committed).toEqual(["second"]);
	});

	it("does not let old revisions delay the latest target commit", async () => {
		const committed: string[] = [];
		const commits: Promise<boolean>[] = [];

		for (let revision = 0; revision < 300; revision += 1) {
			commits.push(
				enqueueTestCommit({
					targetKey: "preview-a",
					revisionKey: `old-${revision}`,
					onCommit: () => committed.push(`old-${revision}`),
				}),
			);
		}

		const latestCommit = enqueueTestCommit({
			targetKey: "preview-a",
			revisionKey: "latest",
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

	it("limits scrolling commits by elapsed time", async () => {
		markScrollActivityActive(scrollSource);
		const committed: string[] = [];

		const commits = ["a", "b", "c"].map((key) =>
			enqueueTestCommit({
				targetKey: key,
				onCommit: () => committed.push(key),
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
			void enqueueTestCommit({
				targetKey: key,
				onCommit: () => committed.push(key),
			});
		}

		await flushAnimationFrame();
		expect(committed).toEqual(["a"]);

		frameIntervalMs = 5000;
		await flushAnimationFrame();
		expect(committed).toEqual(["a", "b"]);
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
});
