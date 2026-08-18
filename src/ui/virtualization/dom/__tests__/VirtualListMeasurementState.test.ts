import { describe, expect, it } from "vitest";
import { createVirtualListMeasurementState } from "../virtualListMeasurementState";

describe("createVirtualListMeasurementState", () => {
	it("tracks stable live metrics and invalidates cached viewport state", () => {
		const state = createVirtualListMeasurementState();

		state.updateFromLiveMetrics(
			{
				sectionTop: 120,
				viewportHeight: 300,
			},
			true,
		);

		expect(state.sectionTop).toBe(120);
		expect(state.viewportHeight).toBe(300);
		expect(state.hasStableScrollMetrics).toBe(true);

		state.invalidateViewport();

		expect(state.viewportHeight).toBe(0);
		expect(state.hasStableScrollMetrics).toBe(false);
	});
});
