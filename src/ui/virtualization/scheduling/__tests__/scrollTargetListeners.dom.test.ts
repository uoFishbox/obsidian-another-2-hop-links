import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeScrollTarget } from "../scrollTargetListeners";

describe("subscribeScrollTarget", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("publishes only the latest scroll snapshot once per frame", () => {
		const target = document.createElement("div");
		const metrics: object[] = [];
		const scrollTops: number[] = [];
		const generations: number[] = [];
		const frameCallbacks: FrameRequestCallback[] = [];
		const requestFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback) => {
				frameCallbacks.push(callback);
				return frameCallbacks.length;
			});
		const unsubscribe = subscribeScrollTarget(target, (phase, snapshot) => {
			if (phase !== "scroll" || !snapshot) return;
			metrics.push(snapshot);
			scrollTops.push(snapshot.scrollTop);
			generations.push(snapshot.scrollGeneration);
		});

		target.scrollTop = 12;
		target.dispatchEvent(new Event("scroll"));
		target.scrollTop = 34;
		target.dispatchEvent(new Event("scroll"));

		expect(requestFrame).toHaveBeenCalledTimes(1);
		expect(scrollTops).toEqual([]);

		frameCallbacks[0]?.(0);

		expect(scrollTops).toEqual([34]);
		expect(generations).toEqual([2]);

		target.scrollTop = 56;
		target.dispatchEvent(new Event("scroll"));
		frameCallbacks[1]?.(16);

		expect(scrollTops).toEqual([34, 56]);
		expect(generations).toEqual([2, 3]);
		expect(metrics[1]).toBe(metrics[0]);

		unsubscribe();
	});

	it("cancels a pending frame when the final subscriber unsubscribes", () => {
		const target = document.createElement("div");
		vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
		const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
		const callback = vi.fn();
		const unsubscribe = subscribeScrollTarget(target, callback);

		target.dispatchEvent(new Event("scroll"));
		unsubscribe();

		expect(cancelFrame).toHaveBeenCalledWith(42);
		expect(callback).not.toHaveBeenCalled();
	});

	it("uses scrollend without starting the idle timeout when supported", () => {
		const target = document.createElement("div");
		Object.defineProperty(target, "onscrollend", {
			configurable: true,
			value: null,
		});
		const phases: string[] = [];
		const frameCallbacks: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frameCallbacks.push(callback);
			return frameCallbacks.length;
		});
		const setTimeout = vi.spyOn(window, "setTimeout");
		const scrollEvent = new Event("scroll");
		const scrollEndEvent = new Event("scrollend");
		const dateNow = vi.spyOn(Date, "now");
		const unsubscribe = subscribeScrollTarget(target, (phase) => {
			phases.push(phase);
		});

		target.dispatchEvent(scrollEvent);
		target.dispatchEvent(scrollEndEvent);

		expect(setTimeout).not.toHaveBeenCalled();
		expect(dateNow).not.toHaveBeenCalled();
		expect(phases).toEqual([]);

		frameCallbacks[0]?.(0);

		expect(phases).toEqual(["start", "scroll", "idle"]);
		unsubscribe();
	});

	it("removes the scrollend listener when the final subscriber unsubscribes", () => {
		const target = document.createElement("div");
		Object.defineProperty(target, "onscrollend", {
			configurable: true,
			value: null,
		});
		const callback = vi.fn();
		const unsubscribe = subscribeScrollTarget(target, callback);

		unsubscribe();
		target.dispatchEvent(new Event("scrollend"));

		expect(callback).not.toHaveBeenCalled();
	});

	it("falls back to the idle timeout when scrollend is unsupported", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const scrollEndDescriptor = Object.getOwnPropertyDescriptor(
			window.HTMLElement.prototype,
			"onscrollend",
		);
		expect(scrollEndDescriptor).toBeDefined();
		Reflect.deleteProperty(window.HTMLElement.prototype, "onscrollend");
		const target = document.createElement("div");
		const phases: string[] = [];
		const frameCallbacks: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frameCallbacks.push(callback);
			return frameCallbacks.length;
		});
		try {
			const unsubscribe = subscribeScrollTarget(target, (phase) => {
				phases.push(phase);
			});

			target.dispatchEvent(new Event("scroll"));
			frameCallbacks[0]?.(0);
			vi.advanceTimersByTime(139);

			expect(phases).toEqual(["start", "scroll"]);

			vi.advanceTimersByTime(2);

			expect(phases).toEqual(["start", "scroll", "idle"]);
			unsubscribe();
		} finally {
			Object.defineProperty(
				window.HTMLElement.prototype,
				"onscrollend",
				scrollEndDescriptor!,
			);
		}
	});
});
