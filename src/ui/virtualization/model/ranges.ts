import { EMPTY_ROW_RANGE, isEmptyRange, type RowRange } from "./rowRange";
import type { VirtualRanges, VirtualRowModel } from "./types";

/**
 * Scroll window used to resolve a single visible row range.
 */
export interface FindVisibleRangeParams {
	scrollTop: number;
	viewportHeight: number;
	overscanPx: number;
}

/**
 * Scroll window used by row models to resolve mounted and preview-visible
 * ranges with a shared row-range writer.
 */
export interface ResolveVirtualRangesParams {
	scrollTop: number;
	viewportHeight: number;
	mountedOverscanPx: number;
	previewOverscanPx?: number;
	mounted?: RowRange;
}

export interface VirtualVisibilityPolicy {
	bootstrapRows: number;
	mountedOverscanPx: number;
	previewOverscanPx?: number;
}

/**
 * Writes the rows intersecting a scroll window into caller-owned storage.
 */
export type WriteVisibleRangeInto = (
	out: RowRange,
	scrollTop: number,
	viewportHeight: number,
	overscanPx: number,
) => void;

function createBootstrapVirtualRowRange(
	rowCount: number,
	bootstrapRows: number,
): RowRange {
	if (rowCount <= 0) {
		return EMPTY_ROW_RANGE;
	}

	return {
		start: 0,
		end: Math.min(rowCount, Math.max(1, bootstrapRows)),
	};
}

export type ComputeVirtualRangesResult =
	| { kind: "empty"; ranges: VirtualRanges }
	| { kind: "bootstrapped"; ranges: VirtualRanges }
	| { kind: "stable"; ranges: VirtualRanges }
	| { kind: "skipped" };

const EMPTY_VIRTUAL_RANGES: VirtualRanges = {
	mounted: EMPTY_ROW_RANGE,
	previewVisible: EMPTY_ROW_RANGE,
};

function copyRowRangeInto(out: RowRange, range: RowRange): void {
	out.start = range.start;
	out.end = range.end;
}

/**
 * Normalizes preview overscan so it remains inside the mounted overscan band.
 */
export function normalizePreviewOverscan(
	value: number | undefined,
	mountedOverscanPx: number,
): number {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
	return Math.min(mountedOverscanPx, value);
}

/**
 * Allocates a single range at the non-hot-path boundary that needs a value result.
 */
export function resolveVisibleRange(
	rowModel: Pick<VirtualRowModel<unknown>, "findVisibleRangeInto">,
	params: FindVisibleRangeParams,
): RowRange {
	const range = { start: 0, end: 0 };
	rowModel.findVisibleRangeInto(range, params);
	return range;
}

/**
 * Resolves mounted and preview-visible ranges into caller-owned storage.
 */
export function resolveVirtualRangesInto(
	out: VirtualRanges,
	params: ResolveVirtualRangesParams,
	writeVisibleRangeInto: WriteVisibleRangeInto,
): void {
	const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
	const previewOverscanPx = normalizePreviewOverscan(
		params.previewOverscanPx,
		mountedOverscanPx,
	);
	if (params.mounted === undefined) {
		writeVisibleRangeInto(
			out.mounted,
			params.scrollTop,
			params.viewportHeight,
			mountedOverscanPx,
		);
	} else {
		copyRowRangeInto(out.mounted, params.mounted);
	}
	if (previewOverscanPx >= mountedOverscanPx) {
		copyRowRangeInto(out.previewVisible, out.mounted);
		return;
	}
	writeVisibleRangeInto(
		out.previewVisible,
		params.scrollTop,
		params.viewportHeight,
		previewOverscanPx,
	);
}

export function computeVirtualRanges<TCell>(params: {
	rowModel: VirtualRowModel<TCell>;
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isStableMeasurement: boolean;
	hasStableVisibleRange: boolean;
	currentMountedRange: RowRange;
	bootstrapRows: number;
	mountedOverscanPx: number;
	previewOverscanPx?: number;
	/**
	 * Value-stable ranges published by the scroll-window resolver. They are
	 * retained by reference, so callers must not mutate them after passing
	 * them here.
	 */
	precomputedRanges?: VirtualRanges;
}): ComputeVirtualRangesResult {
	if (params.rowModel.rowCount <= 0) {
		return { kind: "empty", ranges: EMPTY_VIRTUAL_RANGES };
	}

	if (!params.isStableMeasurement) {
		const shouldUseBootstrapRange =
			params.rowModel.rowCount > 0 &&
			(!params.hasStableVisibleRange ||
				params.currentMountedRange.start >= params.rowModel.rowCount ||
				params.currentMountedRange.end > params.rowModel.rowCount ||
				isEmptyRange(params.currentMountedRange));

		if (!shouldUseBootstrapRange) {
			return { kind: "skipped" };
		}

		const bootstrapRange = createBootstrapVirtualRowRange(
			params.rowModel.rowCount,
			params.bootstrapRows,
		);
		return {
			kind: "bootstrapped",
			ranges: {
				mounted: bootstrapRange,
				previewVisible: EMPTY_ROW_RANGE,
			},
		};
	}

	const relativeScrollTop = params.scrollTop - params.sectionTop;
	let measuredRanges = params.precomputedRanges;
	if (!measuredRanges) {
		measuredRanges = {
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		};
		params.rowModel.findVisibleRangesInto(measuredRanges, {
			scrollTop: relativeScrollTop,
			viewportHeight: params.viewportHeight,
			mountedOverscanPx: params.mountedOverscanPx,
			previewOverscanPx: params.previewOverscanPx,
		});
	}
	return { kind: "stable", ranges: measuredRanges };
}
