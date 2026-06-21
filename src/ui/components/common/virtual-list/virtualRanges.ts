import { EMPTY_ROW_RANGE, isEmptyRange, type RowRange } from "./rowRange";
import type {
	BootstrapReason,
	EmptyReason,
	SkipReason,
} from "./core/VirtualListMode";
import type { VirtualRanges, VirtualRowModel } from "./types";

export function createBootstrapVirtualRowRange(
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
	| {
			mode: { kind: "empty"; reason: EmptyReason };
			ranges: VirtualRanges;
	  }
	| {
			mode: { kind: "bootstrapped"; reason: BootstrapReason };
			ranges: VirtualRanges;
	  }
	| {
			mode: { kind: "stable"; scrolling: boolean };
			ranges: VirtualRanges;
	  }
	| {
			mode: { kind: "skipped"; reason: SkipReason };
	  };

const EMPTY_VIRTUAL_RANGES: VirtualRanges = {
	mounted: EMPTY_ROW_RANGE,
	previewVisible: EMPTY_ROW_RANGE,
};

function copyVirtualRanges(ranges: VirtualRanges): VirtualRanges {
	return {
		mounted: {
			start: ranges.mounted.start,
			end: ranges.mounted.end,
		},
		previewVisible: {
			start: ranges.previewVisible.start,
			end: ranges.previewVisible.end,
		},
	};
}

const resolveBootstrapReason = (params: {
	hasStableVisibleRange: boolean;
	currentMountedRange: RowRange;
	rowCount: number;
}): BootstrapReason => {
	if (!params.hasStableVisibleRange) {
		return "initial";
	}

	if (
		params.currentMountedRange.start >= params.rowCount ||
		params.currentMountedRange.end > params.rowCount
	) {
		return "invalid-mounted-range";
	}

	return "empty-current-range";
};

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
	isScrollActive?: boolean;
	precomputedRanges?: VirtualRanges;
}): ComputeVirtualRangesResult {
	if (params.rowModel.rowCount <= 0) {
		return {
			mode: { kind: "empty", reason: "no-rows" },
			ranges: EMPTY_VIRTUAL_RANGES,
		};
	}

	if (!params.isStableMeasurement) {
		const shouldUseBootstrapRange =
			params.rowModel.rowCount > 0 &&
			(!params.hasStableVisibleRange ||
				params.currentMountedRange.start >= params.rowModel.rowCount ||
				params.currentMountedRange.end > params.rowModel.rowCount ||
				isEmptyRange(params.currentMountedRange));

		if (!shouldUseBootstrapRange) {
			return {
				mode: { kind: "skipped", reason: "unstable-measurement" },
			};
		}

		const bootstrapRange = createBootstrapVirtualRowRange(
			params.rowModel.rowCount,
			params.bootstrapRows,
		);
		return {
			mode: {
				kind: "bootstrapped",
				reason: resolveBootstrapReason({
					hasStableVisibleRange: params.hasStableVisibleRange,
					currentMountedRange: params.currentMountedRange,
					rowCount: params.rowModel.rowCount,
				}),
			},
			ranges: {
				mounted: bootstrapRange,
				previewVisible: bootstrapRange,
			},
		};
	}

	const relativeScrollTop = params.scrollTop - params.sectionTop;
	const measuredRanges: VirtualRanges =
		params.precomputedRanges
			? copyVirtualRanges(params.precomputedRanges)
			: (params.rowModel.findVisibleRanges?.({
				scrollTop: relativeScrollTop,
				viewportHeight: params.viewportHeight,
				mountedOverscanPx: params.mountedOverscanPx,
				previewOverscanPx: params.previewOverscanPx,
			}) ??
				(() => {
					const mountedOverscanPx = Math.max(
						0,
						params.mountedOverscanPx,
					);
					const previewOverscanPx = Math.min(
						mountedOverscanPx,
						Math.max(0, params.previewOverscanPx ?? 0),
					);
					const previewVisible = params.rowModel.findVisibleRange({
						scrollTop: relativeScrollTop,
						viewportHeight: params.viewportHeight,
						overscanPx: previewOverscanPx,
					});
					const mounted =
						mountedOverscanPx <= 0
							? previewVisible
							: params.rowModel.findVisibleRange({
									scrollTop: relativeScrollTop,
									viewportHeight: params.viewportHeight,
									overscanPx: mountedOverscanPx,
								});

					return {
						mounted,
						previewVisible,
					};
				})());
	return {
		mode: { kind: "stable", scrolling: Boolean(params.isScrollActive) },
		ranges: measuredRanges,
	};
}
