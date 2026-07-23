import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeScrollTarget } from "../scrollTargetListeners";

describe("subscribeScrollTarget", () => {
	afterEach(() => {
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
});
