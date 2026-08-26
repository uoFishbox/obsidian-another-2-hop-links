import type { RowRange } from "cards/virtualization/public";

export type PreviewScrollDirection = "stationary" | "forward" | "backward";

/** Resolves the last meaningful row movement without velocity prediction. */
export function resolvePreviewScrollDirection(
	previous: RowRange | undefined,
	current: RowRange,
	fallback: PreviewScrollDirection,
): PreviewScrollDirection {
	if (!previous || previous.start >= previous.end || current.start >= current.end) {
		return fallback;
	}
	const previousCenter = previous.start + previous.end;
	const currentCenter = current.start + current.end;
	if (currentCenter > previousCenter) {
		return "forward";
	}
	if (currentCenter < previousCenter) {
		return "backward";
	}
	return fallback;
}

/** Resolves a fixed two-row directional generation window around the viewport. */
export function resolvePreviewPrefetchRange(
	visible: RowRange,
	rowCount: number,
	direction: PreviewScrollDirection,
): RowRange {
	const before = direction === "backward" ? 2 : direction === "stationary" ? 1 : 0;
	const after = direction === "forward" ? 2 : direction === "stationary" ? 1 : 0;
	return {
		start: Math.max(0, visible.start - before),
		end: Math.min(Math.max(0, rowCount), visible.end + after),
	};
}
