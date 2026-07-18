import { describe, expect, it, vi } from "vitest";
import { subscribeScrollTarget } from "../scrollTargetListeners";

describe("subscribeScrollTarget", () => {
	it("reuses one metrics snapshot while publishing the latest scrollTop", () => {
		vi.useFakeTimers();
		const target = document.createElement("div");
		const metrics: object[] = [];
		const scrollTops: number[] = [];
		const unsubscribe = subscribeScrollTarget(target, (phase, snapshot) => {
			if (phase !== "scroll" || !snapshot) return;
			metrics.push(snapshot);
			scrollTops.push(snapshot.scrollTop);
		});

		target.scrollTop = 12;
		target.dispatchEvent(new Event("scroll"));
		target.scrollTop = 34;
		target.dispatchEvent(new Event("scroll"));

		expect(scrollTops).toEqual([12, 34]);
		expect(metrics[1]).toBe(metrics[0]);

		unsubscribe();
		vi.useRealTimers();
	});
});
