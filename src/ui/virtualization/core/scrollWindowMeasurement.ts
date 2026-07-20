import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";
import type { VirtualVisibilityPolicy } from "./virtualListEngine";
import type {
	MountedScrollWindowMeasurement,
	RangedScrollWindowMeasurement,
	StablePreviewScrollTopBand,
	StableScrollTopBand,
} from "./scrollWindowGate";

type StableScrollTopBandMutable = {
	-readonly [K in keyof StablePreviewScrollTopBand]: StablePreviewScrollTopBand[K];
};

export interface VirtualScrollWindowRangeRowModel {
	readonly rowCount: number;
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
	findStablePreviewScrollTopBandInto(
		out: StableScrollTopBandMutable,
		params: {
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
			previewVisible: RowRange;
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
	};
	const mountedStableBandScratch: StableScrollTopBandMutable = {
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
		stablePreviewScrollTopBand: { min: 0, max: 0 },
	};
	const committedScrollWindowMeasurement: RangedScrollWindowMeasurement = {
		identity: {},
		ranges: {
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		},
		stablePreviewScrollTopBand: { min: 0, max: 0 },
	};

	const resolveMeasurementRowModel = (
		layout: TLayout,
		rowModel: TRowModel | undefined,
	): TRowModel => rowModel ?? resolveRowModel(layout);

	const updateStablePreviewScrollTopBand = (
		out: StableScrollTopBandMutable,
		measurementRowModel: TRowModel,
		sectionTop: number,
		previewVisible: RowRange,
	): void => {
		measurementRowModel.findStablePreviewScrollTopBandInto(out, {
			viewportHeight: rangeParams.viewportHeight,
			mountedOverscanPx: rangeParams.mountedOverscanPx,
			previewOverscanPx: rangeParams.previewOverscanPx,
			previewVisible,
		});
		out.min += sectionTop;
		out.max += sectionTop;
	};

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
			updateStablePreviewScrollTopBand(
				committedScrollWindowMeasurement.stablePreviewScrollTopBand!,
				measurementRowModel,
				sectionTop,
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
		updateStablePreviewScrollTopBand(
			scrollWindowMeasurement.stablePreviewScrollTopBand!,
			measurementRowModel,
			sectionTop,
			scrollWindowMeasurement.ranges.previewVisible,
		);
		return scrollWindowMeasurement;
	};

	return {
		resolveMountedScrollWindowMeasurement,
		resolveScrollWindowMeasurement,
	};
}
