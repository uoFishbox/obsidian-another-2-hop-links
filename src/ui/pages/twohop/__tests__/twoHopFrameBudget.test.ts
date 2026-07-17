import { describe, expect, it } from "vitest";
import { createTwoHopFrameBudgetTracker } from "../twoHopFrameBudget";

describe("twoHopFrameBudget", () => {
	it("adapts the deadline to high refresh intervals", () => {
		const tracker = createTwoHopFrameBudgetTracker();
		tracker.beginFrame(100);
		tracker.beginFrame(104.2);
		tracker.beginFrame(108.4);

		expect(tracker.frameIntervalMs).toBeCloseTo(4.2, 5);
		expect(tracker.deadline - 108.4).toBeCloseTo(0.84, 5);
	});

	it("caps work by bind count as well as time", () => {
		const tracker = createTwoHopFrameBudgetTracker({
			maxShellBindsPerFrame: 2,
			budgetRatio: 1,
			minimumBudgetMs: 10,
			maximumBudgetMs: 10,
		});
		tracker.beginFrame(100);
		expect(tracker.canBind(101)).toBe(true);
		tracker.consumeBind();
		tracker.consumeBind();
		expect(tracker.canBind(101)).toBe(false);
	});
});
