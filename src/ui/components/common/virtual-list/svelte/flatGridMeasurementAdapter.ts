import type { MeasurementUpdateResult } from "../dom/virtualListMeasurementAdapter";
import type { MountedScrollWindowMeasurement } from "../core/scrollWindowGate";
import { createVirtualScrollWindowRangeResolver } from "../core/scrollWindowMeasurement";
import type { VirtualVisibilityPolicy } from "../core/virtualListEngine";
import type { FlatLinkRowModel } from "../row-models/flatLinkRowModel";
import type { RowRange } from "../rowRange";
import type { VirtualRanges } from "../types";

export interface FlatGridRangeMeasurement<T, TLayout> {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isStableMeasurement: boolean;
	isScrollActive: boolean;
	layout: TLayout;
	precomputedRanges?: VirtualRanges;
}

export interface ApplyFlatGridMeasurementParams<
	T,
	TLayout,
> extends FlatGridRangeMeasurement<T, TLayout> {
	rowModel: FlatLinkRowModel<T>;
	visibilityPolicy: VirtualVisibilityPolicy;
}

export interface CreateFlatGridMeasurementAdapterOptions<T, TLayout> {
	resolveRowModel(layout: TLayout): FlatLinkRowModel<T>;
	resolveVisibilityPolicy(layout: TLayout): VirtualVisibilityPolicy;
	applyMeasurement(
		params: ApplyFlatGridMeasurementParams<T, TLayout>,
	): MeasurementUpdateResult<RowRange>;
	getActiveVisibilityRowModel(): object | null;
	syncActiveScrollPreviewRange(params: {
		previewVisible: RowRange;
		rowModel: object;
	}): void;
}

export function createFlatGridMeasurementAdapter<T, TLayout>({
	resolveRowModel,
	resolveVisibilityPolicy,
	applyMeasurement,
	getActiveVisibilityRowModel,
	syncActiveScrollPreviewRange,
}: CreateFlatGridMeasurementAdapterOptions<T, TLayout>) {
	const rangeResolver = createVirtualScrollWindowRangeResolver<
		FlatLinkRowModel<T>,
		TLayout
	>({
		resolveRowModel,
		resolveVisibilityPolicy,
	});

	return {
		applyRangeMeasurement(
			scrollTop: number,
			viewportHeight: number,
			sectionTop: number,
			isStableMeasurement: boolean,
			isScrollActive: boolean,
			layout: TLayout,
			precomputedRanges?: VirtualRanges,
		): MeasurementUpdateResult<RowRange> {
			const rowModel = resolveRowModel(layout);
			return applyMeasurement({
				rowModel,
				scrollTop,
				viewportHeight,
				sectionTop,
				isStableMeasurement,
				isScrollActive,
				layout,
				precomputedRanges,
				visibilityPolicy: resolveVisibilityPolicy(layout),
			});
		},
		resolveMountedScrollWindowMeasurement(
			scrollTop: number,
			viewportHeight: number,
			sectionTop: number,
			layout: TLayout,
		): MountedScrollWindowMeasurement {
			return rangeResolver.resolveMountedScrollWindowMeasurement(
				scrollTop,
				viewportHeight,
				sectionTop,
				layout,
			);
		},
		resolveScrollWindowMeasurement(
			scrollTop: number,
			viewportHeight: number,
			sectionTop: number,
			layout: TLayout,
			precomputedMountedRange: RowRange | undefined,
		) {
			return rangeResolver.resolveScrollWindowMeasurement(
				scrollTop,
				viewportHeight,
				sectionTop,
				layout,
				precomputedMountedRange,
			);
		},
		onActiveScrollPreviewRangeMeasurement(ranges: VirtualRanges): void {
			const activeRowModel = getActiveVisibilityRowModel();
			if (!activeRowModel) {
				return;
			}

			syncActiveScrollPreviewRange({
				previewVisible: ranges.previewVisible,
				rowModel: activeRowModel,
			});
		},
	};
}
