import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";
import type { VirtualVisibilityPolicy } from "./virtualListEngine";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type {
	MountedScrollWindowMeasurement,
	RangedScrollWindowMeasurement,
	StableScrollTopBand,
} from "./scrollWindowGate";

type StableScrollTopBandMutable = {
	-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
};

export interface VirtualScrollWindowRangeRowModel {
	readonly rowCount: number;
	readonly totalHeight: number;
	findVisibleRangeInto(
		out: RowRange,
		params: {
			scrollTop: number;
			viewportHeight: number;
			overscanPx: number;
		},
	): void;
	findVisibleRangesInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
	findVisibleRangesFromMountedInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mounted: RowRange;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
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
}

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
	const rangeParams = {
		scrollTop: 0,
		viewportHeight: 0,
		mountedOverscanPx: 0,
		previewOverscanPx: 0,
	};
	const rangesFromMountedParams = {
		scrollTop: 0,
		viewportHeight: 0,
		mounted: { start: 0, end: 0 },
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
	const scrollWindowMeasurement: RangedScrollWindowMeasurement = {
		identity: {},
		ranges: {
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		},
		previewCoverageScrollTopBand: undefined,
	};
	const committedScrollWindowMeasurement: RangedScrollWindowMeasurement = {
		identity: {},
		ranges: {
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		},
		previewCoverageScrollTopBand: undefined,
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
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.coverageBand.emptyData");
				}
			} else if (viewportHeight > 0 && localScrollTop + viewportHeight <= 0) {
				out.min = Number.NEGATIVE_INFINITY;
				out.max = -viewportHeight;
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.coverageBand.emptyAbove");
				}
			} else if (
				viewportHeight > 0 &&
				localScrollTop >= measurementRowModel.totalHeight
			) {
				out.min = measurementRowModel.totalHeight;
				out.max = Number.POSITIVE_INFINITY;
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.coverageBand.emptyBelow");
				}
			} else {
				out.min = Number.POSITIVE_INFINITY;
				out.max = Number.NEGATIVE_INFINITY;
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.coverageBand.invalid");
				}
			}
		} else {
			if (!measurementRowModel.findMountedCoverageScrollTopBandInto) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("virtualScroll.coverageBand.invalid");
				}
				return undefined;
			}
			measurementRowModel.findMountedCoverageScrollTopBandInto(out, {
				viewportHeight,
				mounted,
				requiredOverscanPx: 0,
			});
			if (process.env.NODE_ENV !== "production" && !(out.min < out.max)) {
				recordCCLDevMeasurement("virtualScroll.coverageBand.invalid");
			}
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
		if (!precomputedMountedRange) {
			committedScrollWindowMeasurement.identity = measurementRowModel;
			measurementRowModel.findVisibleRangesInto(
				committedScrollWindowMeasurement.ranges,
				rangeParams,
			);
			committedScrollWindowMeasurement.previewCoverageScrollTopBand =
				updateCoverageScrollTopBand(
					previewCoverageBandScratch,
					measurementRowModel,
					sectionTop,
					rangeParams.scrollTop,
					viewportHeight,
					committedScrollWindowMeasurement.ranges.previewVisible,
				);
			return committedScrollWindowMeasurement;
		}

		scrollWindowMeasurement.identity = measurementRowModel;
		rangesFromMountedParams.scrollTop = rangeParams.scrollTop;
		rangesFromMountedParams.viewportHeight = rangeParams.viewportHeight;
		rangesFromMountedParams.mounted = precomputedMountedRange;
		rangesFromMountedParams.mountedOverscanPx = rangeParams.mountedOverscanPx;
		rangesFromMountedParams.previewOverscanPx = rangeParams.previewOverscanPx;
		measurementRowModel.findVisibleRangesFromMountedInto(
			scrollWindowMeasurement.ranges,
			rangesFromMountedParams,
		);
		scrollWindowMeasurement.previewCoverageScrollTopBand =
			updateCoverageScrollTopBand(
				previewCoverageBandScratch,
				measurementRowModel,
				sectionTop,
				rangeParams.scrollTop,
				viewportHeight,
				scrollWindowMeasurement.ranges.previewVisible,
			);
		return scrollWindowMeasurement;
	};

	return {
		resolveMountedScrollWindowMeasurement,
		resolveScrollWindowMeasurement,
	};
}
