import type { RowRange } from "ui/virtualization/rowRange";

export type ResidentScrollDirection = "backward" | "forward" | "none";

export interface ResidentWindowPlannerInput {
	readonly current: RowRange;
	readonly visible: RowRange;
	readonly rowCount: number;
	readonly direction: ResidentScrollDirection;
	readonly forwardBehindRows?: number;
	readonly forwardAheadRows?: number;
	readonly backwardBehindRows?: number;
	readonly backwardAheadRows?: number;
}

export interface ResidentWindowPlan {
	readonly start: number;
	readonly end: number;
	readonly visibleWithinCurrent: boolean;
	readonly distantJump: boolean;
	readonly retainedCurrent: boolean;
}

const DEFAULT_FORWARD_BEHIND_ROWS = 2;
const DEFAULT_FORWARD_AHEAD_ROWS = 5;
const DEFAULT_BACKWARD_BEHIND_ROWS = 5;
const DEFAULT_BACKWARD_AHEAD_ROWS = 2;
const DEFAULT_NEUTRAL_BUFFER_ROWS = 5;
const MIN_EDGE_BUFFER_ROWS = 2;

/** Plans a direction-biased resident window without reading DOM or UI state. */
export function planResidentWindow(
	input: ResidentWindowPlannerInput,
): ResidentWindowPlan {
	const rowCount = Math.max(0, input.rowCount);
	const visibleStart = clamp(input.visible.start, 0, rowCount);
	const visibleEnd = clamp(input.visible.end, visibleStart, rowCount);
	if (visibleStart === visibleEnd) {
		return {
			start: visibleStart,
			end: visibleEnd,
			visibleWithinCurrent: false,
			distantJump: false,
			retainedCurrent: false,
		};
	}

	const currentStart = clamp(input.current.start, 0, rowCount);
	const currentEnd = clamp(input.current.end, currentStart, rowCount);
	const hasCurrent = currentStart < currentEnd;
	const visibleWithinCurrent =
		hasCurrent && visibleStart >= currentStart && visibleEnd <= currentEnd;
	const distantJump =
		hasCurrent && (visibleEnd <= currentStart || visibleStart >= currentEnd);
	const behindMargin = visibleStart - currentStart;
	const aheadMargin = currentEnd - visibleEnd;
	const canRetain =
		visibleWithinCurrent &&
		(input.direction === "forward"
			? aheadMargin >= MIN_EDGE_BUFFER_ROWS
			: input.direction === "backward"
				? behindMargin >= MIN_EDGE_BUFFER_ROWS
				: behindMargin >= 1 && aheadMargin >= 1);

	if (canRetain) {
		return {
			start: currentStart,
			end: currentEnd,
			visibleWithinCurrent,
			distantJump,
			retainedCurrent: true,
		};
	}

	const behindRows =
		input.direction === "backward"
			? (input.backwardBehindRows ?? DEFAULT_BACKWARD_BEHIND_ROWS)
			: input.direction === "forward"
				? (input.forwardBehindRows ?? DEFAULT_FORWARD_BEHIND_ROWS)
				: DEFAULT_NEUTRAL_BUFFER_ROWS;
	const aheadRows =
		input.direction === "backward"
			? (input.backwardAheadRows ?? DEFAULT_BACKWARD_AHEAD_ROWS)
			: input.direction === "forward"
				? (input.forwardAheadRows ?? DEFAULT_FORWARD_AHEAD_ROWS)
				: DEFAULT_NEUTRAL_BUFFER_ROWS;

	return {
		start: Math.max(0, visibleStart - Math.max(0, behindRows)),
		end: Math.min(rowCount, visibleEnd + Math.max(0, aheadRows)),
		visibleWithinCurrent,
		distantJump,
		retainedCurrent: false,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
