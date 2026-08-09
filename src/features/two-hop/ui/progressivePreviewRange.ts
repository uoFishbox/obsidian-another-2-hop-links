import {
	resolveTwoHopVisibleWindowInto,
	type TwoHopGeometry,
	type TwoHopRowRange,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import type { MutableStableScrollTopBand } from "ui/virtualization/core/scrollWindowGate";

const PREVIEW_RESIDENT_OVERSCAN_ROWS = 2;
const PREVIEW_RESIDENT_GUARD_ROWS = 1;

/**
 * Resolves the mounted preview window and its open stable scroll interval.
 * The window includes one row of logical overscan.
 * An optional prefix can remain active while the entire content starts below
 * the viewport so its previews can be prepared before the first downward scroll.
 */
export function resolveProgressivePreviewWindowInto(
	rangeTarget: TwoHopRowRange,
	stableBandTarget: MutableStableScrollTopBand,
	geometry: TwoHopGeometry,
	localViewportTop: number,
	viewportHeight: number,
	mountedRowEnd: number,
	offscreenBootstrapRows = 0,
): void {
	const mountedEnd = Math.min(
		geometry.rowCount,
		Math.max(0, Math.floor(mountedRowEnd)),
	);
	const bootstrapRowCount = Math.min(
		mountedEnd,
		Math.max(0, Math.floor(offscreenBootstrapRows)),
	);
	const contentStartsBelowViewport =
		viewportHeight > 0 && localViewportTop <= -viewportHeight;
	if (contentStartsBelowViewport && bootstrapRowCount > 0) {
		rangeTarget.start = 0;
		rangeTarget.end = bootstrapRowCount;
		stableBandTarget.min = Number.NEGATIVE_INFINITY;
		stableBandTarget.max = -viewportHeight;
		return;
	}
	if (mountedEnd === 0 && viewportHeight > 0 && geometry.rowCount > 0) {
		rangeTarget.start = 0;
		rangeTarget.end = 0;
		stableBandTarget.min = Number.NEGATIVE_INFINITY;
		stableBandTarget.max = Number.POSITIVE_INFINITY;
		return;
	}

	const overscan = geometry.rowStride;
	resolveTwoHopVisibleWindowInto(
		rangeTarget,
		stableBandTarget,
		geometry,
		localViewportTop - overscan,
		viewportHeight + overscan * 2,
	);

	rangeTarget.end = Math.min(rangeTarget.end, mountedEnd);
	rangeTarget.start = Math.min(rangeTarget.start, rangeTarget.end);
	stableBandTarget.min += overscan;
	stableBandTarget.max += overscan;
	if (bootstrapRowCount > 0) {
		stableBandTarget.min = Math.max(stableBandTarget.min, -viewportHeight);
	}
}

/** Resolves a bounded host range and preserves it while active rows remain in its guard area. */
export function resolveProgressiveResidentRangeInto(
	target: TwoHopRowRange,
	activeRange: TwoHopRowRange,
	currentResidentRange: TwoHopRowRange,
	mountedRowEnd: number,
): void {
	const mountedEnd = Math.max(0, Math.floor(mountedRowEnd));
	if (activeRange.end <= activeRange.start || mountedEnd === 0) {
		target.start = 0;
		target.end = 0;
		return;
	}

	const activeStart = Math.min(Math.max(0, activeRange.start), mountedEnd);
	const activeEnd = Math.min(Math.max(activeStart, activeRange.end), mountedEnd);
	if (activeEnd <= activeStart) {
		target.start = 0;
		target.end = 0;
		return;
	}
	const residentStart = Math.min(Math.max(0, currentResidentRange.start), mountedEnd);
	const residentEnd = Math.min(
		Math.max(residentStart, currentResidentRange.end),
		mountedEnd,
	);
	const guardedStart =
		residentStart === 0
			? residentStart
			: residentStart + PREVIEW_RESIDENT_GUARD_ROWS;
	const guardedEnd =
		residentEnd === mountedEnd
			? residentEnd
			: residentEnd - PREVIEW_RESIDENT_GUARD_ROWS;
	const activeFitsGuardArea = activeStart >= guardedStart && activeEnd <= guardedEnd;

	if (activeFitsGuardArea) {
		target.start = residentStart;
		target.end = residentEnd;
		return;
	}

	target.start = Math.max(0, activeStart - PREVIEW_RESIDENT_OVERSCAN_ROWS);
	target.end = Math.min(mountedEnd, activeEnd + PREVIEW_RESIDENT_OVERSCAN_ROWS);
}
