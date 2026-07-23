import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";

/**
 * Allocation-conscious scroll-window state.
 *
 * The `update*` functions intentionally mutate the supplied `previous` object
 * rather than allocating a new one on every scroll. Callers should treat the
 * returned object as the canonical state and discard any prior reference.
 */

export type ScrollWindowIdentity = object | string | number | symbol;

export type LastScrollWindow = {
	identity: ScrollWindowIdentity;
	mountedStart: number;
	mountedEnd: number;
	visibleStart: number;
	visibleEnd: number;
	stablePreviewScrollTopMin: number;
	stablePreviewScrollTopMax: number;
	stableMountedScrollTopMin: number;
	stableMountedScrollTopMax: number;
};

export type MountedScrollWindowMeasurement = {
	identity: ScrollWindowIdentity;
	mounted: RowRange;
	stableMountedScrollTopBand?: StableScrollTopBand;
};

export type StableScrollTopBand = {
	readonly min: number;
	readonly max: number;
};

export type StablePreviewScrollTopBand = {
	readonly min: number;
	readonly max: number;
};

/**
 * Open scrollTop interval in which a scroll-window measurement can be skipped.
 */
export interface ScrollMeasurementRange {
	readonly minScrollTopBeforeMeasurement: number;
	readonly maxScrollTopBeforeMeasurement: number;
}

export type RangedScrollWindowMeasurement = {
	identity: ScrollWindowIdentity;
	ranges: VirtualRanges;
	stablePreviewScrollTopBand?: StablePreviewScrollTopBand;
};

export type ActiveScrollWindowComparison = "visible-and-mounted" | "mounted-only";

const INVALID_STABLE_PREVIEW_SCROLL_TOP_MIN = Number.POSITIVE_INFINITY;
const INVALID_STABLE_PREVIEW_SCROLL_TOP_MAX = Number.NEGATIVE_INFINITY;
const INVALID_STABLE_MOUNTED_SCROLL_TOP_MIN = Number.POSITIVE_INFINITY;
const INVALID_STABLE_MOUNTED_SCROLL_TOP_MAX = Number.NEGATIVE_INFINITY;

export const createScrollWindow = (
	identity: ScrollWindowIdentity,
	ranges: VirtualRanges,
	stablePreviewScrollTopBand?: StablePreviewScrollTopBand,
): LastScrollWindow => ({
	identity,
	mountedStart: ranges.mounted.start,
	mountedEnd: ranges.mounted.end,
	visibleStart: ranges.previewVisible.start,
	visibleEnd: ranges.previewVisible.end,
	stablePreviewScrollTopMin:
		stablePreviewScrollTopBand?.min ?? INVALID_STABLE_PREVIEW_SCROLL_TOP_MIN,
	stablePreviewScrollTopMax:
		stablePreviewScrollTopBand?.max ?? INVALID_STABLE_PREVIEW_SCROLL_TOP_MAX,
	stableMountedScrollTopMin: INVALID_STABLE_MOUNTED_SCROLL_TOP_MIN,
	stableMountedScrollTopMax: INVALID_STABLE_MOUNTED_SCROLL_TOP_MAX,
});

export const createMountedScrollWindow = (
	identity: ScrollWindowIdentity,
	mounted: RowRange,
	stableMountedScrollTopBand?: StableScrollTopBand,
): LastScrollWindow => ({
	identity,
	mountedStart: mounted.start,
	mountedEnd: mounted.end,
	visibleStart: 0,
	visibleEnd: 0,
	stablePreviewScrollTopMin: INVALID_STABLE_PREVIEW_SCROLL_TOP_MIN,
	stablePreviewScrollTopMax: INVALID_STABLE_PREVIEW_SCROLL_TOP_MAX,
	stableMountedScrollTopMin:
		stableMountedScrollTopBand?.min ?? INVALID_STABLE_MOUNTED_SCROLL_TOP_MIN,
	stableMountedScrollTopMax:
		stableMountedScrollTopBand?.max ?? INVALID_STABLE_MOUNTED_SCROLL_TOP_MAX,
});

/**
 * Updates `previous` in place to suppress allocation. If `previous` is null, a
 * new object is created.
 */
export const updateMountedAndPreviewScrollWindow = (
	previous: LastScrollWindow | null,
	identity: ScrollWindowIdentity,
	ranges: VirtualRanges,
	stablePreviewScrollTopBand?: StablePreviewScrollTopBand,
	stableMountedScrollTopBand?: StableScrollTopBand,
): LastScrollWindow => {
	if (!previous) {
		const next = createScrollWindow(identity, ranges, stablePreviewScrollTopBand);
		next.stableMountedScrollTopMin =
			stableMountedScrollTopBand?.min ?? INVALID_STABLE_MOUNTED_SCROLL_TOP_MIN;
		next.stableMountedScrollTopMax =
			stableMountedScrollTopBand?.max ?? INVALID_STABLE_MOUNTED_SCROLL_TOP_MAX;
		return next;
	}

	previous.identity = identity;
	previous.mountedStart = ranges.mounted.start;
	previous.mountedEnd = ranges.mounted.end;
	previous.visibleStart = ranges.previewVisible.start;
	previous.visibleEnd = ranges.previewVisible.end;
	previous.stablePreviewScrollTopMin =
		stablePreviewScrollTopBand?.min ?? INVALID_STABLE_PREVIEW_SCROLL_TOP_MIN;
	previous.stablePreviewScrollTopMax =
		stablePreviewScrollTopBand?.max ?? INVALID_STABLE_PREVIEW_SCROLL_TOP_MAX;
	previous.stableMountedScrollTopMin =
		stableMountedScrollTopBand?.min ?? INVALID_STABLE_MOUNTED_SCROLL_TOP_MIN;
	previous.stableMountedScrollTopMax =
		stableMountedScrollTopBand?.max ?? INVALID_STABLE_MOUNTED_SCROLL_TOP_MAX;
	return previous;
};

export const isSameMountedScrollWindow = (
	previous: LastScrollWindow | null,
	identity: ScrollWindowIdentity,
	mounted: RowRange,
): boolean =>
	previous !== null &&
	previous.identity === identity &&
	previous.mountedStart === mounted.start &&
	previous.mountedEnd === mounted.end;

export const isSameRangedScrollWindow = (
	previous: LastScrollWindow | null,
	identity: ScrollWindowIdentity,
	ranges: VirtualRanges,
	comparison: ActiveScrollWindowComparison,
): boolean =>
	previous !== null &&
	previous.identity === identity &&
	previous.mountedStart === ranges.mounted.start &&
	previous.mountedEnd === ranges.mounted.end &&
	(comparison === "mounted-only" ||
		(previous.visibleStart === ranges.previewVisible.start &&
			previous.visibleEnd === ranges.previewVisible.end));

export const isWithinStableMountedScrollWindow = (
	previous: LastScrollWindow | null,
	identity: ScrollWindowIdentity,
	mounted: RowRange,
	scrollTop: number,
): boolean =>
	previous !== null &&
	isSameMountedScrollWindow(previous, identity, mounted) &&
	scrollTop > previous.stableMountedScrollTopMin &&
	scrollTop < previous.stableMountedScrollTopMax;

export const isWithinStablePreviewScrollWindow = (
	previous: LastScrollWindow | null,
	identity: ScrollWindowIdentity,
	mounted: RowRange,
	scrollTop: number,
): boolean =>
	previous !== null &&
	isSameMountedScrollWindow(previous, identity, mounted) &&
	scrollTop > previous.stablePreviewScrollTopMin &&
	scrollTop < previous.stablePreviewScrollTopMax;
