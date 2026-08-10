import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";

/**
 * Allocation-conscious mounted scroll-window state.
 *
 * The update function intentionally mutates the supplied `previous` object
 * rather than allocating a new one on every scroll. Callers should treat the
 * returned object as the canonical state and discard any prior reference.
 */

export type ScrollWindowIdentity = object | string | number | symbol;

export type LastMountedScrollWindow = {
	coverageScrollTopMin: number;
	coverageScrollTopMax: number;
};

export type MountedScrollWindowMeasurement = {
	identity: ScrollWindowIdentity;
	mounted: RowRange;
	stableMountedScrollTopBand?: StableScrollTopBand;
	/** Open interval in which the resident mounted rows cover the required range. */
	mountedCoverageScrollTopBand?: StableScrollTopBand;
};

export type StableScrollTopBand = {
	readonly min: number;
	readonly max: number;
};

/** Caller-owned storage for allocation-conscious stable-band resolution. */
export type MutableStableScrollTopBand = {
	-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
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
	/**
	 * Open interval in which the published preview rows cover the strict viewport.
	 */
	previewCoverageScrollTopBand?: StableScrollTopBand;
};

const INVALID_SCROLL_TOP_MIN = Number.POSITIVE_INFINITY;
const INVALID_SCROLL_TOP_MAX = Number.NEGATIVE_INFINITY;

export const createMountedScrollWindow = (
	coverageScrollTopBand?: StableScrollTopBand,
): LastMountedScrollWindow => ({
	coverageScrollTopMin: coverageScrollTopBand?.min ?? INVALID_SCROLL_TOP_MIN,
	coverageScrollTopMax: coverageScrollTopBand?.max ?? INVALID_SCROLL_TOP_MAX,
});

/**
 * Updates `previous` in place to suppress allocation. If `previous` is null, a
 * new object is created.
 */
export const updateMountedScrollWindow = (
	previous: LastMountedScrollWindow | null,
	coverageScrollTopBand?: StableScrollTopBand,
): LastMountedScrollWindow => {
	if (!previous) {
		return createMountedScrollWindow(coverageScrollTopBand);
	}

	previous.coverageScrollTopMin =
		coverageScrollTopBand?.min ?? INVALID_SCROLL_TOP_MIN;
	previous.coverageScrollTopMax =
		coverageScrollTopBand?.max ?? INVALID_SCROLL_TOP_MAX;
	return previous;
};
