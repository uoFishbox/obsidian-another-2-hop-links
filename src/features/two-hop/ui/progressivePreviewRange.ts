import {
	resolveTwoHopVisibleRowsInto,
	type TwoHopGeometry,
	type TwoHopRowRange,
} from "features/two-hop/ui/viewport/twoHopGeometry";

/** Resolves the mounted preview window with one row of logical overscan. */
export function resolveProgressivePreviewRangeInto(
	target: TwoHopRowRange,
	geometry: TwoHopGeometry,
	localViewportTop: number,
	viewportHeight: number,
	mountedRowEnd: number,
): void {
	const overscan = geometry.rowStride;
	resolveTwoHopVisibleRowsInto(
		target,
		geometry,
		localViewportTop - overscan,
		viewportHeight + overscan * 2,
	);

	const mountedEnd = Math.min(
		geometry.rowCount,
		Math.max(0, Math.floor(mountedRowEnd)),
	);
	target.end = Math.min(target.end, mountedEnd);
	target.start = Math.min(target.start, target.end);
}
