import { afterEach, describe, expect, it, vi } from "vitest";
import {
	markScrollActivityActive,
	markScrollActivityIdle,
	resetScrollActivityForTests,
} from "ui/virtualization/scheduling/scrollActivity";
import { createVirtualFrameCoordinator } from "../frameCoordinator";

afterEach(() => {
	vi.useRealTimers();
	resetScrollActivityForTests();
});

describe("createVirtualFrameCoordinator", () => {
	it("coalesces keyed critical work into one animation frame", () => {
		const frames: FrameRequestCallback[] = [];
		const ownerWindow = {
			requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
				frames.push(callback);
				return frames.length;
			}),
			cancelAnimationFrame: vi.fn(),
		} as unknown as Window;
		const coordinator = createVirtualFrameCoordinator({
			getWindow: () => ownerWindow,
		});
		const first = vi.fn();
		const second = vi.fn();

		expect(coordinator.schedule("scroll-critical", "measurement", first)).toBe(
			true,
		);
		expect(coordinator.schedule("scroll-critical", "measurement", second)).toBe(
			false,
		);
		expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledTimes(1);
		frames[0]?.(0);
		expect(first).toHaveBeenCalledOnce();
		expect(second).not.toHaveBeenCalled();
		coordinator.dispose();
	});

	it("runs at most one post-paint task per drain", async () => {
		vi.useFakeTimers();
		const coordinator = createVirtualFrameCoordinator();
		const order: string[] = [];
		coordinator.schedule("post-paint", "row-1", () => order.push("row-1"));
		coordinator.schedule("post-paint", "row-2", () => order.push("row-2"));

		await vi.runOnlyPendingTimersAsync();
		expect(order).toEqual([]);
		await vi.runOnlyPendingTimersAsync();
		expect(order).toEqual(["row-1"]);
		await vi.runOnlyPendingTimersAsync();
		expect(order).toEqual(["row-1"]);
		await vi.runOnlyPendingTimersAsync();
		expect(order).toEqual(["row-1", "row-2"]);
		coordinator.dispose();
	});

	it("defers critical work scheduled during a drain to the next frame", () => {
		const frames: FrameRequestCallback[] = [];
		const ownerWindow = {
			requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
				frames.push(callback);
				return frames.length;
			}),
			cancelAnimationFrame: vi.fn(),
		} as unknown as Window;
		const coordinator = createVirtualFrameCoordinator({
			getWindow: () => ownerWindow,
		});
		const order: string[] = [];
		coordinator.schedule("scroll-critical", "first", () => {
			order.push("first");
			coordinator.schedule("scroll-critical", "second", () => {
				order.push("second");
			});
		});

		frames[0]?.(0);
		expect(order).toEqual(["first"]);
		expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledTimes(2);
		frames[1]?.(1);
		expect(order).toEqual(["first", "second"]);
		coordinator.dispose();
	});

	it("holds idle work until global scrolling becomes idle", async () => {
		vi.useFakeTimers();
		const scrollSource = {};
		const coordinator = createVirtualFrameCoordinator();
		const task = vi.fn();
		markScrollActivityActive(scrollSource);
		coordinator.schedule("idle", "preview", task);

		await vi.runOnlyPendingTimersAsync();
		expect(task).not.toHaveBeenCalled();
		markScrollActivityIdle(scrollSource);
		await vi.runOnlyPendingTimersAsync();
		expect(task).toHaveBeenCalledOnce();
		coordinator.dispose();
	});
});
