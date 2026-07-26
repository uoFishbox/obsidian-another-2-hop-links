import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPostPaintVirtualListTask,
	createScheduledVirtualListTask,
} from "../virtualListScheduler";
import { createVirtualListMeasurementScheduler } from "../virtualListMeasurementScheduler";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

describe("createVirtualListMeasurementScheduler", () => {
	beforeEach(() => {
		resetCCLDevMeasurements();
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			setTimeout,
			clearTimeout,
		});
	});

	afterEach(() => {
		resetCCLDevMeasurements();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("suppresses scroll measurement while a layout measurement is already pending", async () => {
		const runLayoutMeasurement = vi.fn();
		const runScrollMeasurement = vi.fn();
		const scheduler = createVirtualListMeasurementScheduler({
			runLayoutMeasurement,
			runScrollMeasurement,
			maxUnstableMeasurementRetries: 3,
		});

		scheduler.scheduleLayoutMeasurement();
		scheduler.scheduleScrollMeasurement();

		await vi.runAllTimersAsync();

		expect(runLayoutMeasurement).toHaveBeenCalledTimes(1);
		expect(runScrollMeasurement).toHaveBeenCalledTimes(0);

		scheduler.scheduleScrollMeasurement();
		await vi.runAllTimersAsync();

		expect(runScrollMeasurement).toHaveBeenCalledTimes(1);

		scheduler.cancelAll();
	});

	it("stops scheduling unstable measurement retries after the retry limit", async () => {
		const runLayoutMeasurement = vi.fn();
		const scheduler = createVirtualListMeasurementScheduler({
			runLayoutMeasurement,
			runScrollMeasurement: vi.fn(),
			maxUnstableMeasurementRetries: 2,
		});

		scheduler.scheduleUnstableMeasurementRetry();
		await vi.runAllTimersAsync();
		scheduler.scheduleUnstableMeasurementRetry();
		await vi.runAllTimersAsync();
		scheduler.scheduleUnstableMeasurementRetry();

		expect(runLayoutMeasurement).toHaveBeenCalledTimes(2);
		expect(scheduler.hasPendingLayoutMeasurement()).toBe(false);

		await vi.advanceTimersByTimeAsync(250);
		expect(runLayoutMeasurement).toHaveBeenCalledTimes(2);

		scheduler.resetUnstableMeasurementRetry();
		scheduler.scheduleUnstableMeasurementRetry();
		await vi.runAllTimersAsync();

		expect(runLayoutMeasurement).toHaveBeenCalledTimes(3);
	});

	it("delegates measurement work to the coordinator critical lane", () => {
		const scheduledTasks = new Map<string, () => void>();
		const frameCoordinator: VirtualFrameCoordinator = {
			schedule: vi.fn((lane, key, task) => {
				const taskKey = `${lane}:${key}`;
				if (scheduledTasks.has(taskKey)) return false;
				scheduledTasks.set(taskKey, task);
				return true;
			}),
			cancel: vi.fn((lane, key) => {
				scheduledTasks.delete(`${lane}:${key}`);
			}),
			isScheduled: vi.fn((lane, key) => scheduledTasks.has(`${lane}:${key}`)),
			dispose: vi.fn(),
		};
		const runScrollMeasurement = vi.fn();
		const scheduler = createVirtualListMeasurementScheduler({
			runLayoutMeasurement: vi.fn(),
			runScrollMeasurement,
			maxUnstableMeasurementRetries: 3,
			frameCoordinator,
		});

		scheduler.scheduleScrollMeasurement();
		expect(frameCoordinator.schedule).toHaveBeenCalledWith(
			"scroll-critical",
			"virtual-list:scroll-measurement",
			expect.any(Function),
		);
		scheduledTasks.get("scroll-critical:virtual-list:scroll-measurement")?.();
		expect(runScrollMeasurement).toHaveBeenCalledOnce();
	});

	it("retains an observer task while layout temporarily supersedes scroll", () => {
		const scheduledTasks = new Map<string, () => void>();
		const frameCoordinator: VirtualFrameCoordinator = {
			schedule: vi.fn((lane, key, task) => {
				const taskKey = `${lane}:${key}`;
				if (scheduledTasks.has(taskKey)) return false;
				scheduledTasks.set(taskKey, task);
				return true;
			}),
			cancel: vi.fn((lane, key) => {
				scheduledTasks.delete(`${lane}:${key}`);
			}),
			isScheduled: vi.fn((lane, key) => scheduledTasks.has(`${lane}:${key}`)),
			dispose: vi.fn(),
		};
		const observerTask = vi.fn();
		const scheduler = createVirtualListMeasurementScheduler({
			runLayoutMeasurement: vi.fn(),
			runScrollMeasurement: vi.fn(),
			maxUnstableMeasurementRetries: 3,
			frameCoordinator,
		});

		scheduler.scheduleScrollMeasurement(observerTask);
		scheduler.scheduleLayoutMeasurement();
		expect(
			scheduledTasks.has("scroll-critical:virtual-list:scroll-measurement"),
		).toBe(false);

		scheduledTasks.get("scroll-critical:virtual-list:layout-measurement")?.();
		scheduledTasks.delete("scroll-critical:virtual-list:layout-measurement");
		scheduler.scheduleScrollMeasurement();
		scheduledTasks.get("scroll-critical:virtual-list:scroll-measurement")?.();

		expect(observerTask).toHaveBeenCalledOnce();
	});
});

describe("createPostPaintVirtualListTask", () => {
	beforeEach(() => {
		resetCCLDevMeasurements();
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			setTimeout,
			clearTimeout,
		});
	});

	afterEach(() => {
		resetCCLDevMeasurements();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("schedules callback after double rAF by default", async () => {
		const callback = vi.fn();
		const task = createPostPaintVirtualListTask(callback);

		task.schedule();
		expect(callback).not.toHaveBeenCalled();
		expect(task.isScheduled()).toBe(true);

		await vi.runAllTimersAsync();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(task.isScheduled()).toBe(false);
		expect(
			getCCLDevMeasurementSnapshot().counters[
				"virtualList.postPaintScheduler.animationFrame"
			].count,
		).toBe(0);
	});

	it("respects custom frame delay", async () => {
		const callback = vi.fn();
		const task = createPostPaintVirtualListTask(callback, 3);

		task.schedule();
		expect(callback).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();

		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("counts each post-paint animation frame", () => {
		const handlers: Array<() => void> = [];
		vi.stubGlobal("window", {
			requestAnimationFrame: (handler: () => void) => {
				handlers.push(handler);
				return handlers.length;
			},
			cancelAnimationFrame: vi.fn(),
			setTimeout,
			clearTimeout,
		});
		const task = createPostPaintVirtualListTask(vi.fn());

		task.schedule();
		handlers[0]();
		handlers[1]();

		expect(
			getCCLDevMeasurementSnapshot().counters[
				"virtualList.postPaintScheduler.animationFrame"
			].count,
		).toBe(2);
	});

	it("does not schedule if already scheduled", () => {
		const callback = vi.fn();
		const task = createPostPaintVirtualListTask(callback);

		expect(task.schedule()).toBe(true);
		expect(task.schedule()).toBe(false);
		expect(task.isScheduled()).toBe(true);
	});

	it("cancels pending task", async () => {
		const callback = vi.fn();
		const task = createPostPaintVirtualListTask(callback);

		task.schedule();
		task.cancel();

		expect(task.isScheduled()).toBe(false);

		await vi.runAllTimersAsync();

		expect(callback).not.toHaveBeenCalled();
	});

	it("does nothing when cancelled mid-frame", async () => {
		const callback = vi.fn();
		const task = createPostPaintVirtualListTask(callback, 2);

		task.schedule();
		task.cancel();

		await vi.runAllTimersAsync();

		expect(callback).not.toHaveBeenCalled();
		expect(task.isScheduled()).toBe(false);
	});
});

describe("createScheduledVirtualListTask", () => {
	beforeEach(() => {
		resetCCLDevMeasurements();
	});

	afterEach(() => {
		resetCCLDevMeasurements();
		vi.unstubAllGlobals();
	});

	it("schedules callback via requestAnimationFrame when available", () => {
		const handlers: Array<() => void> = [];
		vi.stubGlobal("window", {
			requestAnimationFrame: (handler: () => void) => {
				handlers.push(handler);
				return handlers.length;
			},
			cancelAnimationFrame: vi.fn(),
			setTimeout,
			clearTimeout,
		});

		const callback = vi.fn();
		const task = createScheduledVirtualListTask(callback);

		expect(task.schedule()).toBe(true);
		expect(task.isScheduled()).toBe(true);

		handlers[0]();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(task.isScheduled()).toBe(false);
		expect(
			getCCLDevMeasurementSnapshot().counters[
				"virtualList.scheduler.animationFrame"
			].count,
		).toBe(1);
	});

	it("falls back to setTimeout when requestAnimationFrame is unavailable", () => {
		const handlers: Array<() => void> = [];
		vi.stubGlobal("window", {
			setTimeout: (handler: () => void, _delay: number) => {
				handlers.push(handler);
				return handlers.length;
			},
			clearTimeout: vi.fn(),
		});

		const callback = vi.fn();
		const task = createScheduledVirtualListTask(callback);

		expect(task.schedule()).toBe(true);

		handlers[0]();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(task.isScheduled()).toBe(false);
	});

	it("does not schedule if already scheduled", () => {
		vi.stubGlobal("window", {
			requestAnimationFrame: vi.fn(() => 1),
			cancelAnimationFrame: vi.fn(),
			setTimeout,
			clearTimeout,
		});

		const task = createScheduledVirtualListTask(vi.fn());

		expect(task.schedule()).toBe(true);
		expect(task.schedule()).toBe(false);
		expect(task.isScheduled()).toBe(true);
	});

	it("cancels pending task", () => {
		const cancelAnimationFrame = vi.fn();
		vi.stubGlobal("window", {
			requestAnimationFrame: vi.fn(() => 42),
			cancelAnimationFrame,
			setTimeout,
			clearTimeout,
		});

		const callback = vi.fn();
		const task = createScheduledVirtualListTask(callback);

		task.schedule();
		task.cancel();

		expect(task.isScheduled()).toBe(false);
		expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
	});

	it("reuses the same handler closure across schedule() calls", () => {
		const handlers: Array<() => void> = [];
		vi.stubGlobal("window", {
			requestAnimationFrame: (handler: () => void) => {
				handlers.push(handler);
				return handlers.length;
			},
			cancelAnimationFrame: vi.fn(),
			setTimeout,
			clearTimeout,
		});

		const callback = vi.fn();
		const task = createScheduledVirtualListTask(callback);

		task.schedule();
		const firstHandler = handlers[0];
		firstHandler();

		task.schedule();
		const secondHandler = handlers[1];

		expect(secondHandler).toBe(firstHandler);
		secondHandler();
		expect(callback).toHaveBeenCalledTimes(2);
	});
});
