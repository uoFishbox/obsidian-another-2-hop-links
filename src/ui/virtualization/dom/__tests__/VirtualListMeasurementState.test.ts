import { describe, expect, it } from "vitest";
import {
	createVirtualListMeasurementState,
	resolveVirtualListMeasurementPhase,
} from "../virtualListMeasurementState";

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

	it("resolves measurement phase from the legacy boolean state", () => {
		const state = createVirtualListMeasurementState();

		expect(resolveVirtualListMeasurementPhase(state)).toEqual({
			type: "unmeasured",
		});

		state.updateFromLiveMetrics(
			{
				sectionTop: 40,
				viewportHeight: 200,
			},
			false,
		);
		expect(state.resolvePhase()).toEqual({
			type: "unstable",
			sectionTop: 40,
			viewportHeight: 200,
		});

		state.hasStableVisibleRange = true;
		state.updateFromLiveMetrics(
			{
				sectionTop: 80,
				viewportHeight: 240,
			},
			true,
		);
		expect(state.resolvePhase()).toEqual({
			type: "stable",
			sectionTop: 80,
			viewportHeight: 240,
			visibleRangeStable: true,
		});
	});
});
