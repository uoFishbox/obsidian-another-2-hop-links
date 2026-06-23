import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";

export type ScrollWindowIdentity = object | string | number | symbol;

export type LastScrollWindow = {
	identity: ScrollWindowIdentity;
	mountedStart: number;
	mountedEnd: number;
	visibleStart: number;
	visibleEnd: number;
	stablePreviewScrollTopMin: number;
	stablePreviewScrollTopMax: number;
};

export type MountedScrollWindowMeasurement = {
	identity: ScrollWindowIdentity;
	mounted: RowRange;
};

export type StablePreviewScrollTopBand = {
	readonly min: number;
	readonly max: number;
};

export type RangedScrollWindowMeasurement = {
	identity: ScrollWindowIdentity;
	ranges: VirtualRanges;
	stablePreviewScrollTopBand?: StablePreviewScrollTopBand;
};

export type ActiveScrollWindowComparison = "visible-and-mounted" | "mounted-only";

const INVALID_STABLE_PREVIEW_SCROLL_TOP_MIN = Number.POSITIVE_INFINITY;
const INVALID_STABLE_PREVIEW_SCROLL_TOP_MAX = Number.NEGATIVE_INFINITY;

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
});

export const createMountedScrollWindow = (
	identity: ScrollWindowIdentity,
	mounted: RowRange,
): LastScrollWindow => ({
	identity,
	mountedStart: mounted.start,
	mountedEnd: mounted.end,
	visibleStart: 0,
	visibleEnd: 0,
	stablePreviewScrollTopMin: INVALID_STABLE_PREVIEW_SCROLL_TOP_MIN,
	stablePreviewScrollTopMax: INVALID_STABLE_PREVIEW_SCROLL_TOP_MAX,
});

export const updateScrollWindow = (
	previous: LastScrollWindow | null,
	identity: ScrollWindowIdentity,
	ranges: VirtualRanges,
	stablePreviewScrollTopBand?: StablePreviewScrollTopBand,
): LastScrollWindow => {
	if (!previous) {
		return createScrollWindow(identity, ranges, stablePreviewScrollTopBand);
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
	return previous;
};

export const updateMountedScrollWindow = (
	previous: LastScrollWindow | null,
	identity: ScrollWindowIdentity,
	mounted: RowRange,
): LastScrollWindow => {
	if (!previous) {
		return createMountedScrollWindow(identity, mounted);
	}

	previous.identity = identity;
	previous.mountedStart = mounted.start;
	previous.mountedEnd = mounted.end;
	previous.visibleStart = 0;
	previous.visibleEnd = 0;
	previous.stablePreviewScrollTopMin = INVALID_STABLE_PREVIEW_SCROLL_TOP_MIN;
	previous.stablePreviewScrollTopMax = INVALID_STABLE_PREVIEW_SCROLL_TOP_MAX;
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
