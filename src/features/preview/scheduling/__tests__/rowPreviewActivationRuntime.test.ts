import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createRowPreviewActivationRuntime,
	type RowPreviewActivationRuntime,
} from "../rowPreviewActivationRuntime";
import { resetPreviewActivationSchedulerForTests } from "../previewActivationScheduler";

interface ObservedRowActivation {
	readonly versions: number[];
	readonly unsubscribe: () => void;
}

interface ObservedActivation {
	readonly versions: number[];
	readonly unsubscribe: () => void;
}

function observeRowActivation(
	runtime: RowPreviewActivationRuntime,
	rowIndex: number,
): ObservedRowActivation {
	const versions: number[] = [];
	const unsubscribe = runtime
		.getRowActivationVersion(rowIndex)
		.subscribe((version) => {
			versions.push(version);
		});

	return { versions, unsubscribe };
}

function observeActivation(
	runtime: RowPreviewActivationRuntime,
	key: string,
): ObservedActivation {
	const versions: number[] = [];
	const unsubscribe = runtime.getActivationVersion(key).subscribe((version) => {
		versions.push(version);
	});

	return { versions, unsubscribe };
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
	it("activates a caller-provided key when it becomes visible", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const observed = observeActivation(runtime, "slot:0");

		runtime.setVisibility("slot:0", "visible");
		await flushAnimationFrame();

		expect(observed.versions).toEqual([0, 1]);
		observed.unsubscribe();
	});

	it("does not activate a mounted row", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const observed = observeRowActivation(runtime, 0);

		runtime.requestRowActivation(0);
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(observed.versions).toEqual([0]);
		observed.unsubscribe();
	});

	it("activates a row when it becomes visible", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const observed = observeRowActivation(runtime, 0);

		runtime.setRowVisibility(0, "visible");
		await flushAnimationFrame();

		expect(observed.versions).toEqual([0, 1]);
		observed.unsubscribe();
	});

	it("deduplicates multiple activation requests for the same visible row", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const observed = observeRowActivation(runtime, 0);

		runtime.setRowVisibility(0, "visible");
		runtime.requestRowActivation(0);
		runtime.requestRowActivation(0);
		runtime.requestRowActivation(0);
		await flushAnimationFrame();

		expect(observed.versions).toEqual([0, 1]);
		observed.unsubscribe();
	});

	it("limits activation scheduling to two rows per animation frame", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const observedRows = [0, 1, 2].map((rowIndex) =>
			observeRowActivation(runtime, rowIndex),
		);

		for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
			runtime.setRowVisibility(rowIndex, "visible");
		}

		await flushAnimationFrame();
		expect(observedRows.map((row) => row.versions)).toEqual([[0, 1], [0, 1], [0]]);

		await flushAnimationFrame();
		expect(observedRows.map((row) => row.versions)).toEqual([
			[0, 1],
			[0, 1],
			[0, 1],
		]);

		for (const observed of observedRows) {
			observed.unsubscribe();
		}
	});

	it("cancels pending activation when a row returns to mounted", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const observed = observeRowActivation(runtime, 0);

		runtime.setRowVisibility(0, "visible");
		runtime.setRowVisibility(0, "mounted");
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(observed.versions).toEqual([0]);
		observed.unsubscribe();
	});

	it("removes pending activation when a row is cleared", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const observed = observeRowActivation(runtime, 0);

		runtime.setRowVisibility(0, "visible");
		runtime.clearRow(0);
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(observed.versions).toEqual([0]);
		observed.unsubscribe();
	});

	it("activates again when a visible row receives a later request", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const observed = observeRowActivation(runtime, 0);

		runtime.setRowVisibility(0, "visible");
		await flushAnimationFrame();

		runtime.requestRowActivation(0);
		await flushAnimationFrame();

		expect(observed.versions).toEqual([0, 1, 2]);
		observed.unsubscribe();
	});

	it("waits for the visible preview queue to drain", async () => {
		let visibleQueueSize = 1;
		const runtime = createRowPreviewActivationRuntime({
			getVisibleQueueSize: () => visibleQueueSize,
		});
		const observed = observeRowActivation(runtime, 0);

		runtime.setRowVisibility(0, "visible");
		await flushAnimationFrame();
		expect(observed.versions).toEqual([0]);

		visibleQueueSize = 0;
		await flushAnimationFrame();
		expect(observed.versions).toEqual([0, 1]);

		observed.unsubscribe();
	});

	it("exposes the latest activation version to late subscribers", async () => {
		const runtime = createRowPreviewActivationRuntime();

		runtime.setRowVisibility(0, "visible");
		await flushAnimationFrame();

		const observed = observeRowActivation(runtime, 0);

		expect(observed.versions).toEqual([1]);
		observed.unsubscribe();
	});

	it("starts a cleared row with a fresh activation version store", async () => {
		const runtime = createRowPreviewActivationRuntime();
		const oldObserved = observeRowActivation(runtime, 0);

		runtime.setRowVisibility(0, "visible");
		await flushAnimationFrame();
		runtime.clearRow(0);

		const newObserved = observeRowActivation(runtime, 0);
		runtime.setRowVisibility(0, "visible");
		await flushAnimationFrame();

		expect(oldObserved.versions).toEqual([0, 1]);
		expect(newObserved.versions).toEqual([0, 1]);
		oldObserved.unsubscribe();
		newObserved.unsubscribe();
	});
});
