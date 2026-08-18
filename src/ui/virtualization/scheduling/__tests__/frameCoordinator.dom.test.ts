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

	it("keeps animation-frame work on its own keyed frame", () => {
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
		const frameTask = vi.fn();
		const criticalTask = vi.fn();

		coordinator.schedule("animation-frame", "dependency-refresh", frameTask);
		coordinator.schedule("scroll-critical", "measurement", criticalTask);
		expect(frames).toHaveLength(2);

		frames[0]?.(0);
		expect(frameTask).toHaveBeenCalledOnce();
		expect(criticalTask).not.toHaveBeenCalled();

		frames[1]?.(1);
		expect(criticalTask).toHaveBeenCalledOnce();
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

	it("defers a cancelled and replaced task to the next frame", () => {
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
			coordinator.cancel("scroll-critical", "second");
			coordinator.schedule("scroll-critical", "second", () => {
				order.push("replacement");
			});
		});
		coordinator.schedule("scroll-critical", "second", () => {
			order.push("original");
		});

		frames[0]?.(0);
		expect(order).toEqual(["first"]);
		expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledTimes(2);
		frames[1]?.(1);
		expect(order).toEqual(["first", "replacement"]);
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

	it("runs idle work through the watchdog when idle callbacks starve", async () => {
		vi.useFakeTimers();
		const requestIdleCallback = vi.fn(() => 17);
		const cancelIdleCallback = vi.fn();
		const ownerWindow = {
			requestIdleCallback,
			cancelIdleCallback,
			setTimeout: window.setTimeout.bind(window),
			clearTimeout: window.clearTimeout.bind(window),
		} as unknown as Window;
		const coordinator = createVirtualFrameCoordinator({
			getWindow: () => ownerWindow,
		});
		const task = vi.fn();

		coordinator.schedule("idle", "hydration", task);
		await vi.advanceTimersByTimeAsync(49);
		expect(task).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);

		expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
			timeout: 50,
		});
		expect(cancelIdleCallback).toHaveBeenCalledWith(17);
		expect(task).toHaveBeenCalledOnce();
		coordinator.dispose();
	});
	it("cancels old-realm work and reschedules it after a window migration", () => {
		const firstFrames: FrameRequestCallback[] = [];
		const secondFrames: FrameRequestCallback[] = [];
		const firstWindow = {
			requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
				firstFrames.push(callback);
				return 11;
			}),
			cancelAnimationFrame: vi.fn(),
		} as unknown as Window;
		const secondWindow = {
			requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
				secondFrames.push(callback);
				return 22;
			}),
			cancelAnimationFrame: vi.fn(),
		} as unknown as Window;
		let migrate: ((ownerWindow: Window) => void) | undefined;
		const unregister = vi.fn();
		const element = {
			ownerDocument: { defaultView: firstWindow },
			onWindowMigrated: vi.fn((listener: (ownerWindow: Window) => void) => {
				migrate = listener;
				return unregister;
			}),
		} as unknown as HTMLElement;
		const coordinator = createVirtualFrameCoordinator();
		const task = vi.fn();

		coordinator.bindOwnerElement?.(element);
		coordinator.schedule("scroll-critical", "measurement", task);
		expect(firstWindow.requestAnimationFrame).toHaveBeenCalledOnce();

		migrate?.(secondWindow);
		expect(firstWindow.cancelAnimationFrame).toHaveBeenCalledWith(11);
		expect(secondWindow.requestAnimationFrame).toHaveBeenCalledOnce();
		expect(task).not.toHaveBeenCalled();

		secondFrames[0]?.(0);
		expect(task).toHaveBeenCalledOnce();
		coordinator.dispose();
		expect(unregister).toHaveBeenCalledOnce();
	});
});
