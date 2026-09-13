import type { RowRange, VirtualVisibilityPolicy } from "../model/ranges";
import type {
	MutableVirtualRanges,
	VirtualRanges,
	VirtualRowModel,
} from "../model/types";

export interface StableScrollTopBand {
	readonly min: number;
	readonly max: number;
}

export interface ScrollWindowMeasurement {
	readonly ranges: VirtualRanges;
	/** Open interval in which resident mounted rows cover the required range. */
	readonly mountedCoverageScrollTopBand?: StableScrollTopBand;
	/** Open interval in which published preview rows cover the strict viewport. */
	readonly previewCoverageScrollTopBand?: StableScrollTopBand;
}

type MutableScrollWindowMeasurement = {
	-readonly [K in keyof ScrollWindowMeasurement]: ScrollWindowMeasurement[K];
};

export type MutableStableScrollTopBand = {
	-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
};

export type VirtualScrollWindowRangeRowModel = Pick<
	VirtualRowModel<unknown>,
	"rowCount" | "totalHeight" | "findVisibleRangesInto"
> & {
	/** Writes the open scrollTop interval covered by the supplied resident rows. */
	findMountedCoverageScrollTopBandInto?(
		out: MutableStableScrollTopBand,
		params: {
			viewportHeight: number;
			mounted: RowRange;
			requiredOverscanPx: number;
		},
	): void;
};

/** Resolves one atomic mounted/preview range measurement and its coverage. */
export function createVirtualScrollWindowRangeResolver<
	TRowModel extends VirtualScrollWindowRangeRowModel,
>() {
	const rangeParams = {
		scrollTop: 0,
		viewportHeight: 0,
		mountedOverscanPx: 0,
		previewOverscanPx: 0,
	};
	const mountedCoverageBandScratch: MutableStableScrollTopBand = {
		min: 0,
		max: 0,
	};
	const previewCoverageBandScratch: MutableStableScrollTopBand = {
		min: 0,
		max: 0,
	};
	// Row models write ranges in place, so the writable scratch stays private and
	// only value-stable published snapshots are exposed on the measurement.
	const mutableRangesScratch: MutableVirtualRanges = {
		mounted: { start: 0, end: 0 },
		previewVisible: { start: 0, end: 0 },
	};
	const scrollWindowMeasurement: MutableScrollWindowMeasurement = {
		ranges: mutableRangesScratch,
		mountedCoverageScrollTopBand: undefined,
		previewCoverageScrollTopBand: undefined,
	};
	let lastPublishedRanges: VirtualRanges | undefined;

	const publishStableRanges = (
		scratch: MutableVirtualRanges,
		previous: VirtualRanges | undefined,
	): VirtualRanges => {
		if (
			previous &&
			previous.mounted.start === scratch.mounted.start &&
			previous.mounted.end === scratch.mounted.end &&
			previous.previewVisible.start === scratch.previewVisible.start &&
			previous.previewVisible.end === scratch.previewVisible.end
		) {
			return previous;
		}
		return Object.freeze({
			mounted: Object.freeze({
				start: scratch.mounted.start,
				end: scratch.mounted.end,
			}),
			previewVisible: Object.freeze({
				start: scratch.previewVisible.start,
				end: scratch.previewVisible.end,
			}),
		});
	};

	const updateCoverageScrollTopBand = (
		out: MutableStableScrollTopBand,
		rowModel: TRowModel,
		sectionTop: number,
		localScrollTop: number,
		viewportHeight: number,
		range: RowRange,
	): StableScrollTopBand | undefined => {
		if (range.start >= range.end) {
			if (rowModel.rowCount === 0) {
				out.min = Number.NEGATIVE_INFINITY;
				out.max = Number.POSITIVE_INFINITY;
			} else if (viewportHeight > 0 && localScrollTop + viewportHeight <= 0) {
				out.min = Number.NEGATIVE_INFINITY;
				out.max = -viewportHeight;
			} else if (viewportHeight > 0 && localScrollTop >= rowModel.totalHeight) {
				out.min = rowModel.totalHeight;
				out.max = Number.POSITIVE_INFINITY;
			} else {
				out.min = Number.POSITIVE_INFINITY;
				out.max = Number.NEGATIVE_INFINITY;
			}
		} else {
			if (!rowModel.findMountedCoverageScrollTopBandInto) return undefined;
			rowModel.findMountedCoverageScrollTopBandInto(out, {
				viewportHeight,
				mounted: range,
				requiredOverscanPx: 0,
			});
		}
		out.min += sectionTop;
		out.max += sectionTop;
		return out;
	};

	const resolveScrollWindowMeasurement = (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		rowModel: TRowModel,
		visibilityPolicy: VirtualVisibilityPolicy,
	): ScrollWindowMeasurement => {
		const localScrollTop = scrollTop - sectionTop;

		rangeParams.scrollTop = localScrollTop;
		rangeParams.viewportHeight = viewportHeight;
		rangeParams.mountedOverscanPx = visibilityPolicy.mountedOverscanPx;
		rangeParams.previewOverscanPx = visibilityPolicy.previewOverscanPx ?? 0;
		rowModel.findVisibleRangesInto(mutableRangesScratch, rangeParams);
		lastPublishedRanges = publishStableRanges(
			mutableRangesScratch,
			lastPublishedRanges,
		);
		scrollWindowMeasurement.ranges = lastPublishedRanges;
		scrollWindowMeasurement.mountedCoverageScrollTopBand =
			updateCoverageScrollTopBand(
				mountedCoverageBandScratch,
				rowModel,
				sectionTop,
				localScrollTop,
				viewportHeight,
				lastPublishedRanges.mounted,
			);
		scrollWindowMeasurement.previewCoverageScrollTopBand =
			updateCoverageScrollTopBand(
				previewCoverageBandScratch,
				rowModel,
				sectionTop,
				localScrollTop,
				viewportHeight,
				lastPublishedRanges.previewVisible,
			);
		return scrollWindowMeasurement;
	};

	return { resolveScrollWindowMeasurement };
}
