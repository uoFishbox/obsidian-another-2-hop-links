import type { RowRange } from "../model/ranges";
import type {
	MutableVirtualRanges,
	VirtualRanges,
	VirtualRowModel,
} from "../model/types";
import type { VirtualVisibilityPolicy } from "../model/ranges";
export type ScrollWindowIdentity = object | string | number | symbol;

export interface StableScrollTopBand {
	readonly min: number;
	readonly max: number;
}

export interface MountedScrollWindowMeasurement {
	identity: ScrollWindowIdentity;
	mounted: RowRange;
	stableMountedScrollTopBand?: StableScrollTopBand;
	/** Open interval in which resident mounted rows cover the required range. */
	mountedCoverageScrollTopBand?: StableScrollTopBand;
}

export interface RangedScrollWindowMeasurement {
	identity: ScrollWindowIdentity;
	ranges: VirtualRanges;
	/** Open interval in which published preview rows cover the strict viewport. */
	previewCoverageScrollTopBand?: StableScrollTopBand;
}

type StableScrollTopBandMutable = {
	-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
};

export type VirtualScrollWindowRangeRowModel = Pick<
	VirtualRowModel<unknown>,
	"rowCount" | "totalHeight" | "findVisibleRangeInto" | "findVisibleRangesInto"
> & {
	findStableMountedScrollTopBandInto?(
		out: StableScrollTopBandMutable,
		params: {
			mountedOverscanPx: number;
			viewportHeight: number;
			mounted: RowRange;
		},
	): void;
	/**
	 * Writes the open scrollTop interval covered by the supplied resident rows.
	 */
	findMountedCoverageScrollTopBandInto?(
		out: StableScrollTopBandMutable,
		params: {
			viewportHeight: number;
			mounted: RowRange;
			requiredOverscanPx: number;
		},
	): void;
};

export interface CreateVirtualScrollWindowRangeResolverOptions<
	TRowModel extends VirtualScrollWindowRangeRowModel,
	TLayout,
> {
	resolveRowModel(layout: TLayout): TRowModel;
	resolveVisibilityPolicy(layout: TLayout): VirtualVisibilityPolicy;
	resolveStableMountedScrollTopBand?: boolean;
}

export function createVirtualScrollWindowRangeResolver<
	TRowModel extends VirtualScrollWindowRangeRowModel,
	TLayout,
>({
	resolveRowModel,
	resolveVisibilityPolicy,
	resolveStableMountedScrollTopBand = false,
}: CreateVirtualScrollWindowRangeResolverOptions<TRowModel, TLayout>) {
	const mountedRangeParams = {
		scrollTop: 0,
		viewportHeight: 0,
		overscanPx: 0,
	};
	const rangeParams: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx: number;
		mounted?: RowRange;
	} = {
		scrollTop: 0,
		viewportHeight: 0,
		mountedOverscanPx: 0,
		previewOverscanPx: 0,
	};
	const mountedScrollWindowMeasurement: MountedScrollWindowMeasurement = {
		identity: {},
		mounted: { start: 0, end: 0 },
		stableMountedScrollTopBand: undefined,
		mountedCoverageScrollTopBand: undefined,
	};
	const mountedStableBandScratch: StableScrollTopBandMutable = {
		min: 0,
		max: 0,
	};
	const mountedCoverageBandScratch: StableScrollTopBandMutable = {
		min: 0,
		max: 0,
	};
	const previewCoverageBandScratch: StableScrollTopBandMutable = {
		min: 0,
		max: 0,
	};
	let mountedStableBandViewportHeight: number | undefined;
	let mountedStableBandSectionTop: number | undefined;
	let mountedStableBandOverscanPx: number | undefined;
	// Row models write ranges in place, so the writable scratch stays private and
	// only value-stable published snapshots are exposed on the measurements.
	const scrollRangesScratch: MutableVirtualRanges = {
		mounted: { start: 0, end: 0 },
		previewVisible: { start: 0, end: 0 },
	};
	const committedRangesScratch: MutableVirtualRanges = {
		mounted: { start: 0, end: 0 },
		previewVisible: { start: 0, end: 0 },
	};
	const scrollWindowMeasurement: RangedScrollWindowMeasurement = {
		identity: {},
		ranges: scrollRangesScratch,
		previewCoverageScrollTopBand: undefined,
	};
	const committedScrollWindowMeasurement: RangedScrollWindowMeasurement = {
		identity: {},
		ranges: committedRangesScratch,
		previewCoverageScrollTopBand: undefined,
	};
	let lastPublishedScrollRanges: VirtualRanges | undefined;
	let lastPublishedCommittedRanges: VirtualRanges | undefined;

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

	const resolveMeasurementRowModel = (
		layout: TLayout,
		rowModel: TRowModel | undefined,
	): TRowModel => rowModel ?? resolveRowModel(layout);

	const updateStableMountedScrollTopBand = (
		out: StableScrollTopBandMutable,
		measurementRowModel: TRowModel,
		sectionTop: number,
		mountedOverscanPx: number,
		viewportHeight: number,
		mounted: RowRange,
	): StableScrollTopBand | undefined => {
		if (!resolveStableMountedScrollTopBand) {
			return undefined;
		}
		if (!measurementRowModel.findStableMountedScrollTopBandInto) {
			return undefined;
		}
		if (mounted.start >= mounted.end) {
			return undefined;
		}

		measurementRowModel.findStableMountedScrollTopBandInto(out, {
			mountedOverscanPx,
			viewportHeight,
			mounted,
		});
		out.min += sectionTop;
		out.max += sectionTop;
		return out;
	};
	const updateCoverageScrollTopBand = (
		out: StableScrollTopBandMutable,
		measurementRowModel: TRowModel,
		sectionTop: number,
		localScrollTop: number,
		viewportHeight: number,
		mounted: RowRange,
	): StableScrollTopBand | undefined => {
		if (!resolveStableMountedScrollTopBand) {
			return undefined;
		}
		if (mounted.start >= mounted.end) {
			if (measurementRowModel.rowCount === 0) {
				out.min = Number.NEGATIVE_INFINITY;
				out.max = Number.POSITIVE_INFINITY;
			} else if (viewportHeight > 0 && localScrollTop + viewportHeight <= 0) {
				out.min = Number.NEGATIVE_INFINITY;
				out.max = -viewportHeight;
			} else if (
				viewportHeight > 0 &&
				localScrollTop >= measurementRowModel.totalHeight
			) {
				out.min = measurementRowModel.totalHeight;
				out.max = Number.POSITIVE_INFINITY;
			} else {
				out.min = Number.POSITIVE_INFINITY;
				out.max = Number.NEGATIVE_INFINITY;
			}
		} else {
			if (!measurementRowModel.findMountedCoverageScrollTopBandInto) {
				return undefined;
			}
			measurementRowModel.findMountedCoverageScrollTopBandInto(out, {
				viewportHeight,
				mounted,
				requiredOverscanPx: 0,
			});
		}
		out.min += sectionTop;
		out.max += sectionTop;
		return out;
	};

	const resolveMountedScrollWindowMeasurement = (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		layout: TLayout,
		rowModel?: TRowModel,
	): MountedScrollWindowMeasurement => {
		const measurementRowModel = resolveMeasurementRowModel(layout, rowModel);
		const visibilityPolicy = resolveVisibilityPolicy(layout);
		const localScrollTop = scrollTop - sectionTop;
		const mountedOverscanPx = visibilityPolicy.mountedOverscanPx;

		const prevBand = mountedScrollWindowMeasurement.stableMountedScrollTopBand;
		if (
			resolveStableMountedScrollTopBand &&
			prevBand !== undefined &&
			scrollTop > prevBand.min &&
			scrollTop < prevBand.max &&
			mountedScrollWindowMeasurement.identity === measurementRowModel &&
			mountedStableBandViewportHeight === viewportHeight &&
			mountedStableBandSectionTop === sectionTop &&
			mountedStableBandOverscanPx === mountedOverscanPx
		) {
			return mountedScrollWindowMeasurement;
		}

		mountedRangeParams.scrollTop = localScrollTop;
		mountedRangeParams.viewportHeight = viewportHeight;
		mountedRangeParams.overscanPx = mountedOverscanPx;
		mountedScrollWindowMeasurement.identity = measurementRowModel;
		measurementRowModel.findVisibleRangeInto(
			mountedScrollWindowMeasurement.mounted,
			mountedRangeParams,
		);
		mountedScrollWindowMeasurement.stableMountedScrollTopBand =
			updateStableMountedScrollTopBand(
				mountedStableBandScratch,
				measurementRowModel,
				sectionTop,
				mountedOverscanPx,
				viewportHeight,
				mountedScrollWindowMeasurement.mounted,
			);
		mountedScrollWindowMeasurement.mountedCoverageScrollTopBand =
			updateCoverageScrollTopBand(
				mountedCoverageBandScratch,
				measurementRowModel,
				sectionTop,
				localScrollTop,
				viewportHeight,
				mountedScrollWindowMeasurement.mounted,
			);
		mountedStableBandViewportHeight = viewportHeight;
		mountedStableBandSectionTop = sectionTop;
		mountedStableBandOverscanPx = mountedOverscanPx;
		return mountedScrollWindowMeasurement;
	};

	const resolveScrollWindowMeasurement = (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		layout: TLayout,
		precomputedMountedRange?: RowRange,
		rowModel?: TRowModel,
	): RangedScrollWindowMeasurement => {
		const measurementRowModel = resolveMeasurementRowModel(layout, rowModel);
		const visibilityPolicy = resolveVisibilityPolicy(layout);

		rangeParams.scrollTop = scrollTop - sectionTop;
		rangeParams.viewportHeight = viewportHeight;
		rangeParams.mountedOverscanPx = visibilityPolicy.mountedOverscanPx;
		rangeParams.previewOverscanPx = visibilityPolicy.previewOverscanPx ?? 0;
		rangeParams.mounted = precomputedMountedRange;
		if (!precomputedMountedRange) {
			committedScrollWindowMeasurement.identity = measurementRowModel;
			measurementRowModel.findVisibleRangesInto(
				committedRangesScratch,
				rangeParams,
			);
			lastPublishedCommittedRanges = publishStableRanges(
				committedRangesScratch,
				lastPublishedCommittedRanges,
			);
			committedScrollWindowMeasurement.ranges = lastPublishedCommittedRanges;
			committedScrollWindowMeasurement.previewCoverageScrollTopBand =
				updateCoverageScrollTopBand(
					previewCoverageBandScratch,
					measurementRowModel,
					sectionTop,
					rangeParams.scrollTop,
					viewportHeight,
					lastPublishedCommittedRanges.previewVisible,
				);
			return committedScrollWindowMeasurement;
		}

		scrollWindowMeasurement.identity = measurementRowModel;
		measurementRowModel.findVisibleRangesInto(scrollRangesScratch, rangeParams);
		lastPublishedScrollRanges = publishStableRanges(
			scrollRangesScratch,
			lastPublishedScrollRanges,
		);
		scrollWindowMeasurement.ranges = lastPublishedScrollRanges;
		scrollWindowMeasurement.previewCoverageScrollTopBand =
			updateCoverageScrollTopBand(
				previewCoverageBandScratch,
				measurementRowModel,
				sectionTop,
				rangeParams.scrollTop,
				viewportHeight,
				lastPublishedScrollRanges.previewVisible,
			);
		return scrollWindowMeasurement;
	};

	return {
		resolveMountedScrollWindowMeasurement,
		resolveScrollWindowMeasurement,
	};
}
