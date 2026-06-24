import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createRowPreviewActivationRuntime,
	type RowPreviewActivationCandidate,
	type RowPreviewActivationRuntime,
} from "../rowPreviewActivationRuntime";
import {
	resetPreviewActivationSchedulerForTests,
} from "../previewActivationScheduler";

interface TestCandidateOptions {
	readonly id: string;
	readonly rowIndex: number;
	readonly activationKey: string;
	readonly onActivated?: (key: string) => void;
}

function createTestCandidate(
	options: TestCandidateOptions,
): RowPreviewActivationCandidate {
	return {
		id: options.id,
		rowIndex: options.rowIndex,
		activationKey: options.activationKey,
		getVisibleQueueSize: () => 0,
		onActivated: options.onActivated ?? (() => undefined),
	};
}

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
	resetPreviewActivationSchedulerForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("rowPreviewActivationRuntime", () => {
	it("does not enqueue candidates for a mounted row", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const onActivated = vi.fn();

		runtime.registerCandidate(
			createTestCandidate({
				id: "c1",
				rowIndex: 0,
				activationKey: "key-a",
				onActivated,
			}),
		);
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(onActivated).not.toHaveBeenCalled();
	});

	it("enqueues candidates when a row becomes visible", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const onActivated = vi.fn();

		runtime.setRowVisibility(0, "visible");
		runtime.registerCandidate(
			createTestCandidate({
				id: "c1",
				rowIndex: 0,
				activationKey: "key-a",
				onActivated,
			}),
		);
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(onActivated).toHaveBeenCalledWith("key-a");
	});

	it("activates at most two candidates per animation frame", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const activatedKeys: string[] = [];

		runtime.setRowVisibility(0, "visible");
		for (let i = 0; i < 4; i += 1) {
			runtime.registerCandidate(
				createTestCandidate({
					id: `c${i}`,
					rowIndex: 0,
					activationKey: `key-${i}`,
					onActivated: (key) => activatedKeys.push(key),
				}),
			);
		}

		await flushAnimationFrame();
		expect(activatedKeys).toEqual(["key-0", "key-1"]);

		await flushAnimationFrame();
		expect(activatedKeys).toEqual([
			"key-0",
			"key-1",
			"key-2",
			"key-3",
		]);
	});

	it("cancels pending activations when a row returns to mounted", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const onActivated = vi.fn();

		runtime.setRowVisibility(0, "visible");
		runtime.registerCandidate(
			createTestCandidate({
				id: "c1",
				rowIndex: 0,
				activationKey: "key-a",
				onActivated,
			}),
		);
		runtime.setRowVisibility(0, "mounted");
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(onActivated).not.toHaveBeenCalled();
	});

	it("removes candidates and pending activations when a row is unmounted", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const onActivated = vi.fn();

		runtime.setRowVisibility(0, "visible");
		runtime.registerCandidate(
			createTestCandidate({
				id: "c1",
				rowIndex: 0,
				activationKey: "key-a",
				onActivated,
			}),
		);
		runtime.clearRow(0);
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(onActivated).not.toHaveBeenCalled();
	});

	it("enqueues candidates registered after the row is already visible", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const onActivated = vi.fn();

		runtime.setRowVisibility(0, "visible");
		runtime.registerCandidate(
			createTestCandidate({
				id: "c1",
				rowIndex: 0,
				activationKey: "key-a",
				onActivated,
			}),
		);
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(onActivated).toHaveBeenCalledWith("key-a");
	});

	it("does not call onActivated for a replaced activation key", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const onActivatedA = vi.fn();
		const onActivatedB = vi.fn();

		runtime.setRowVisibility(0, "visible");
		const cleanupA = runtime.registerCandidate(
			createTestCandidate({
				id: "c1",
				rowIndex: 0,
				activationKey: "key-a",
				onActivated: onActivatedA,
			}),
		);
		cleanupA();
		runtime.registerCandidate(
			createTestCandidate({
				id: "c2",
				rowIndex: 0,
				activationKey: "key-b",
				onActivated: onActivatedB,
			}),
		);
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(onActivatedA).not.toHaveBeenCalled();
		expect(onActivatedB).toHaveBeenCalledWith("key-b");
	});

	it("notifies all visible candidates sharing the same activation key", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const onActivatedA = vi.fn();
		const onActivatedB = vi.fn();

		runtime.setRowVisibility(1, "visible");
		runtime.setRowVisibility(5, "visible");
		runtime.registerCandidate(
			createTestCandidate({
				id: "c1",
				rowIndex: 1,
				activationKey: "shared-key",
				onActivated: onActivatedA,
			}),
		);
		runtime.registerCandidate(
			createTestCandidate({
				id: "c2",
				rowIndex: 5,
				activationKey: "shared-key",
				onActivated: onActivatedB,
			}),
		);
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(onActivatedA).toHaveBeenCalledWith("shared-key");
		expect(onActivatedB).toHaveBeenCalledWith("shared-key");
	});

	it("keeps pending activation when another visible row shares the same key", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const onActivatedA = vi.fn();
		const onActivatedB = vi.fn();

		runtime.setRowVisibility(1, "visible");
		runtime.setRowVisibility(5, "visible");
		runtime.registerCandidate(
			createTestCandidate({
				id: "c1",
				rowIndex: 1,
				activationKey: "shared-key",
				onActivated: onActivatedA,
			}),
		);
		runtime.registerCandidate(
			createTestCandidate({
				id: "c2",
				rowIndex: 5,
				activationKey: "shared-key",
				onActivated: onActivatedB,
			}),
		);
		runtime.setRowVisibility(1, "mounted");
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(onActivatedA).not.toHaveBeenCalled();
		expect(onActivatedB).toHaveBeenCalledWith("shared-key");
	});
});
