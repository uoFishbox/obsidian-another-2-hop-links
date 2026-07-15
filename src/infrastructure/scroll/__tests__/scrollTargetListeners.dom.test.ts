import { describe, expect, it } from "vitest";
import { subscribeScrollTarget, type ScrollPhase } from "../scrollTargetListeners";

describe("subscribeScrollTarget", () => {
	it("passes scrollTop as a primitive on native scroll events", () => {
		const target = document.createElement("div");
		target.scrollTop = 42;
		const events: Array<readonly [ScrollPhase, number | undefined]> = [];
		const unsubscribe = subscribeScrollTarget(target, (phase, scrollTop) => {
			events.push([phase, scrollTop]);
		});

		target.dispatchEvent(new Event("scroll"));
		unsubscribe();

		expect(events).toEqual([
			["start", undefined],
			["scroll", 42],
		]);
		expect(typeof events[1]?.[1]).toBe("number");
	});
});
