import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPostPaintVirtualListTask,
	createVirtualListMeasurementScheduler,
} from "../virtualListScheduler";

describe("createVirtualListMeasurementScheduler", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			setTimeout,
			clearTimeout,
		});
	});

	afterEach(() => {
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
});

describe("createPostPaintVirtualListTask", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			setTimeout,
			clearTimeout,
		});
	});

	afterEach(() => {
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
	});

	it("respects custom frame delay", async () => {
		const callback = vi.fn();
		const task = createPostPaintVirtualListTask(callback, 3);

		task.schedule();
		expect(callback).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();

		expect(callback).toHaveBeenCalledTimes(1);
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
