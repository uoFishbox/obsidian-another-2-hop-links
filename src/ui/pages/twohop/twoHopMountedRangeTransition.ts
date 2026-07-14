import type { RowRange } from "ui/components/common/virtual-list/rowRange";

export interface MountedRangeTransitionInput {
	previous: RowRange;
	next: RowRange;
	dirty: RowRange;
	planChanged: boolean;
	poolChanged: boolean;
	capacity: number;
}

/** Reusable, allocation-free output for one mounted-range transition. */
export interface MountedRangeTransitionScratch {
	shouldCommit: boolean;
	clearAll: boolean;
	clearOutsideNextRange: boolean;
	rebindAll: boolean;
	enteringLeadingStart: number;
	enteringLeadingEnd: number;
	enteringTrailingStart: number;
	enteringTrailingEnd: number;
	leavingLeadingStart: number;
	leavingLeadingEnd: number;
	leavingTrailingStart: number;
	leavingTrailingEnd: number;
	dirtyStart: number;
	dirtyEnd: number;
}

/** Creates scratch state once; callers reuse it for every scroll frame. */
export function createMountedRangeTransitionScratch(): MountedRangeTransitionScratch {
	return {
		shouldCommit: false,
		clearAll: false,
		clearOutsideNextRange: false,
		rebindAll: false,
		enteringLeadingStart: 0,
		enteringLeadingEnd: 0,
		enteringTrailingStart: 0,
		enteringTrailingEnd: 0,
		leavingLeadingStart: 0,
		leavingLeadingEnd: 0,
		leavingTrailingStart: 0,
		leavingTrailingEnd: 0,
		dirtyStart: 0,
		dirtyEnd: 0,
	};
}

/** Plans the exact bind/clear ranges without touching DOM or reactive state. */
export function planMountedRangeTransition(
	scratch: MountedRangeTransitionScratch,
	input: MountedRangeTransitionInput,
): MountedRangeTransitionScratch {
	const hasDirtyRows =
		input.dirty.start < input.dirty.end &&
		input.dirty.start < input.next.end &&
		input.dirty.end > input.next.start;
	const rangeChanged =
		input.previous.start !== input.next.start ||
		input.previous.end !== input.next.end;
	const shouldCommit =
		input.planChanged || input.poolChanged || rangeChanged || hasDirtyRows;

	scratch.shouldCommit = shouldCommit;
	scratch.clearAll = shouldCommit && input.capacity === 0;
	scratch.rebindAll =
		shouldCommit && input.capacity > 0 && (input.planChanged || input.poolChanged);
	scratch.clearOutsideNextRange =
		scratch.rebindAll && input.planChanged && !input.poolChanged;

	if (!shouldCommit || scratch.clearAll || scratch.rebindAll) {
		clearPartialRanges(scratch);
		return scratch;
	}

	scratch.enteringLeadingStart = input.next.start;
	scratch.enteringLeadingEnd = Math.min(input.next.end, input.previous.start);
	scratch.enteringTrailingStart = Math.max(input.next.start, input.previous.end);
	scratch.enteringTrailingEnd = input.next.end;
	scratch.leavingLeadingStart = input.previous.start;
	scratch.leavingLeadingEnd = Math.min(input.previous.end, input.next.start);
	scratch.leavingTrailingStart = Math.max(input.previous.start, input.next.end);
	scratch.leavingTrailingEnd = input.previous.end;
	scratch.dirtyStart = hasDirtyRows
		? Math.max(input.next.start, input.dirty.start)
		: input.next.start;
	scratch.dirtyEnd = hasDirtyRows
		? Math.min(input.next.end, input.dirty.end)
		: input.next.start;
	return scratch;
}

function clearPartialRanges(scratch: MountedRangeTransitionScratch): void {
	scratch.enteringLeadingStart = 0;
	scratch.enteringLeadingEnd = 0;
	scratch.enteringTrailingStart = 0;
	scratch.enteringTrailingEnd = 0;
	scratch.leavingLeadingStart = 0;
	scratch.leavingLeadingEnd = 0;
	scratch.leavingTrailingStart = 0;
	scratch.leavingTrailingEnd = 0;
	scratch.dirtyStart = 0;
	scratch.dirtyEnd = 0;
}
