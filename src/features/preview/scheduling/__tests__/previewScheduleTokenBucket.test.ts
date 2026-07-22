import { describe, expect, it } from "vitest";
import {
	consumePreviewScheduleToken,
	createEmptyPreviewScheduleTokenState,
	refillPreviewScheduleTokens,
	type PreviewScheduleTokenPolicy,
} from "../previewScheduleTokenBucket";

const IDLE_POLICY: PreviewScheduleTokenPolicy = {
	mode: "idle",
	ratePerSecond: 120,
	creditCapacity: 2,
};

const SCROLLING_POLICY: PreviewScheduleTokenPolicy = {
	mode: "scrolling",
	ratePerSecond: 64,
	creditCapacity: 4,
	initialCredits: 1,
};

describe("preview schedule token bucket", () => {
	it("uses initial credits when the first policy is scrolling", () => {
		const state = refillPreviewScheduleTokens(
			createEmptyPreviewScheduleTokenState(),
			1_000,
			SCROLLING_POLICY,
		);

		expect(state).toEqual({
			availableCredits: 1,
			lastRefillTimestamp: 1_000,
			policyMode: "scrolling",
		});
	});

	it("clamps carried credit and resets refill time when scrolling starts", () => {
		const idleState = consumePreviewScheduleToken(
			refillPreviewScheduleTokens(
				createEmptyPreviewScheduleTokenState(),
				1_000,
				IDLE_POLICY,
			),
		);
		const scrollingState = refillPreviewScheduleTokens(
			idleState,
			2_000,
			SCROLLING_POLICY,
		);

		expect(scrollingState).toEqual({
			availableCredits: 1,
			lastRefillTimestamp: 2_000,
			policyMode: "scrolling",
		});
	});
});
