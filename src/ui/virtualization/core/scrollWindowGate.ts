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
	identity: ScrollWindowIdentity;
	mountedStart: number;
	mountedEnd: number;
	stableScrollTopMin: number;
	stableScrollTopMax: number;
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

const INVALID_STABLE_SCROLL_TOP_MIN = Number.POSITIVE_INFINITY;
const INVALID_STABLE_SCROLL_TOP_MAX = Number.NEGATIVE_INFINITY;

export const createMountedScrollWindow = (
	identity: ScrollWindowIdentity,
	mounted: RowRange,
	stableScrollTopBand?: StableScrollTopBand,
	coverageScrollTopBand?: StableScrollTopBand,
): LastMountedScrollWindow => ({
	identity,
	mountedStart: mounted.start,
	mountedEnd: mounted.end,
	stableScrollTopMin: stableScrollTopBand?.min ?? INVALID_STABLE_SCROLL_TOP_MIN,
	stableScrollTopMax: stableScrollTopBand?.max ?? INVALID_STABLE_SCROLL_TOP_MAX,
	coverageScrollTopMin: coverageScrollTopBand?.min ?? INVALID_STABLE_SCROLL_TOP_MIN,
	coverageScrollTopMax: coverageScrollTopBand?.max ?? INVALID_STABLE_SCROLL_TOP_MAX,
});

/**
 * Updates `previous` in place to suppress allocation. If `previous` is null, a
 * new object is created.
 */
export const updateMountedScrollWindow = (
	previous: LastMountedScrollWindow | null,
	identity: ScrollWindowIdentity,
	mounted: RowRange,
	stableScrollTopBand?: StableScrollTopBand,
	coverageScrollTopBand?: StableScrollTopBand,
): LastMountedScrollWindow => {
	if (!previous) {
		return createMountedScrollWindow(
			identity,
			mounted,
			stableScrollTopBand,
			coverageScrollTopBand,
		);
	}

	previous.identity = identity;
	previous.mountedStart = mounted.start;
	previous.mountedEnd = mounted.end;
	previous.stableScrollTopMin =
		stableScrollTopBand?.min ?? INVALID_STABLE_SCROLL_TOP_MIN;
	previous.stableScrollTopMax =
		stableScrollTopBand?.max ?? INVALID_STABLE_SCROLL_TOP_MAX;
	previous.coverageScrollTopMin =
		coverageScrollTopBand?.min ?? INVALID_STABLE_SCROLL_TOP_MIN;
	previous.coverageScrollTopMax =
		coverageScrollTopBand?.max ?? INVALID_STABLE_SCROLL_TOP_MAX;
	return previous;
};

export const isSameMountedScrollWindow = (
	previous: LastMountedScrollWindow | null,
	identity: ScrollWindowIdentity,
	mounted: RowRange,
): boolean =>
	previous !== null &&
	previous.identity === identity &&
	previous.mountedStart === mounted.start &&
	previous.mountedEnd === mounted.end;

export const isWithinStableMountedScrollWindow = (
	previous: LastMountedScrollWindow | null,
	identity: ScrollWindowIdentity,
	mounted: RowRange,
	scrollTop: number,
): boolean =>
	previous !== null &&
	isSameMountedScrollWindow(previous, identity, mounted) &&
	scrollTop > previous.stableScrollTopMin &&
	scrollTop < previous.stableScrollTopMax;
