import type {
	MutableRowRange,
	MutableVirtualRanges,
	RowRange,
	VirtualRanges,
	VirtualRowModel,
} from "./types";

export type { MutableRowRange, RowRange } from "./types";

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
	out: MutableRowRange,
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

const EMPTY_VIRTUAL_RANGES: VirtualRanges = Object.freeze({
	mounted: EMPTY_ROW_RANGE,
	previewVisible: EMPTY_ROW_RANGE,
});

function freezeVirtualRanges<T extends VirtualRanges>(ranges: T): T {
	Object.freeze(ranges.mounted);
	Object.freeze(ranges.previewVisible);
	return Object.freeze(ranges);
}

function copyRowRangeInto(out: MutableRowRange, range: RowRange): void {
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
	out: MutableVirtualRanges,
	params: ResolveVirtualRangesParams,
	writeVisibleRangeInto: WriteVisibleRangeInto,
): void {
	const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
	const previewOverscanPx = normalizePreviewOverscan(
		params.previewOverscanPx,
		mountedOverscanPx,
	);
	writeVisibleRangeInto(
		out.mounted,
		params.scrollTop,
		params.viewportHeight,
		mountedOverscanPx,
	);
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
			ranges: freezeVirtualRanges({
				mounted: Object.freeze(bootstrapRange),
				previewVisible: EMPTY_ROW_RANGE,
			}),
		};
	}

	const relativeScrollTop = params.scrollTop - params.sectionTop;
	let measuredRanges: VirtualRanges | MutableVirtualRanges | undefined =
		params.precomputedRanges;
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
	return { kind: "stable", ranges: freezeVirtualRanges(measuredRanges) };
}
