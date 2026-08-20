export interface RowRange {
	readonly start: number;
	readonly end: number;
}

/** Caller-owned scratch range used by row-model writers. */
export interface MutableRowRange {
	start: number;
	end: number;
}

export const EMPTY_ROW_RANGE: RowRange = Object.freeze({ start: 0, end: 0 });

export function isEmptyRange(range: RowRange): boolean {
	return range.end <= range.start;
}

export function sameRange(a: RowRange, b: RowRange): boolean {
	return a.start === b.start && a.end === b.end;
}

export function clampRange(range: RowRange, itemCount: number): RowRange {
	const count = Math.max(0, itemCount);
	const start = Math.min(count, Math.max(0, range.start));
	const end = Math.min(count, Math.max(start, range.end));

	return { start, end };
}
