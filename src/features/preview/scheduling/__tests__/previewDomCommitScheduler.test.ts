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

async function flushAnimationFrame(): Promise<void> {
	await vi.advanceTimersByTimeAsync(16);
	await Promise.resolve();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) =>
			setTimeout(() => callback(Date.now()), 16),
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

	it("limits commits to one per frame while scrolling", async () => {
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

	it("drains up to four commits per frame while idle", async () => {
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

	it("skips stale commits without consuming the frame budget", async () => {
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
