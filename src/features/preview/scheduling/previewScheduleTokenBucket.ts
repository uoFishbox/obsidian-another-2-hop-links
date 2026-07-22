export const MAX_TOKEN_REFILL_ELAPSED_MS = 250;
export const TOKEN_CREDIT_EPSILON = 1e-9;

export type PreviewScheduleTokenPolicyMode = "idle" | "backpressured" | "scrolling";

export interface PreviewScheduleTokenPolicy {
	readonly mode: PreviewScheduleTokenPolicyMode;
	readonly ratePerSecond: number;
	readonly creditCapacity: number;
	readonly initialCredits?: number;
}

export interface PreviewScheduleTokenState {
	readonly availableCredits: number;
	readonly lastRefillTimestamp: number | null;
	readonly policyMode: PreviewScheduleTokenPolicyMode | null;
}

export function createEmptyPreviewScheduleTokenState(): PreviewScheduleTokenState {
	return {
		availableCredits: 0,
		lastRefillTimestamp: null,
		policyMode: null,
	};
}

export function refillPreviewScheduleTokens(
	state: PreviewScheduleTokenState,
	timestamp: number,
	policy: PreviewScheduleTokenPolicy,
): PreviewScheduleTokenState {
	if (state.lastRefillTimestamp === null) {
		return {
			availableCredits: Math.min(
				policy.creditCapacity,
				Math.max(0, policy.initialCredits ?? policy.creditCapacity),
			),
			lastRefillTimestamp: timestamp,
			policyMode: policy.mode,
		};
	}

	const enteredScrolling =
		state.policyMode !== null &&
		state.policyMode !== "scrolling" &&
		policy.mode === "scrolling";
	const availableCredits = enteredScrolling
		? Math.min(state.availableCredits, policy.initialCredits ?? 1)
		: state.availableCredits;
	const lastRefillTimestamp = enteredScrolling
		? timestamp
		: state.lastRefillTimestamp;
	const elapsedMs = Math.min(
		MAX_TOKEN_REFILL_ELAPSED_MS,
		Math.max(0, timestamp - lastRefillTimestamp),
	);

	return {
		availableCredits: Math.min(
			policy.creditCapacity,
			availableCredits + (elapsedMs * policy.ratePerSecond) / 1000,
		),
		lastRefillTimestamp: timestamp,
		policyMode: policy.mode,
	};
}

export function canConsumePreviewScheduleToken(
	state: PreviewScheduleTokenState,
): boolean {
	return state.availableCredits + TOKEN_CREDIT_EPSILON >= 1;
}

export function consumePreviewScheduleToken(
	state: PreviewScheduleTokenState,
): PreviewScheduleTokenState {
	return {
		availableCredits: Math.max(0, state.availableCredits - 1),
		lastRefillTimestamp: state.lastRefillTimestamp,
		policyMode: state.policyMode,
	};
}
