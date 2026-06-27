export interface TwoHopVirtualListTuning {
	readonly initialMaterialization: {
		/**
		 * Maximum number of sections to materialize during the first
		 * synchronous layout pass. Sections beyond this count are deferred to
		 * background materialization.
		 */
		readonly maxSectionCount: number;
		/**
		 * Maximum number of cells to materialize during the first synchronous
		 * layout pass.
		 */
		readonly maxCellCount: number;
	};
	readonly backgroundMaterialization: {
		/**
		 * Maximum number of cells to materialize per idle-callback / rAF slice
		 * during background materialization.
		 */
		readonly maxCellCountPerSlice: number;
	};
}

/**
 * Default tuning values.
 *
 * Picked conservatively for typical desktop viewports (~1440-2560 px wide) at
 * default density (1x). When switching to high-density or mobile layouts with
 * significantly fewer visible cells per viewport, consider reducing the cell
 * limits; when targeting low-end devices, reduce the background slice size.
 */
export const DEFAULT_TWO_HOP_VIRTUAL_LIST_TUNING: TwoHopVirtualListTuning = {
	initialMaterialization: {
		maxSectionCount: 8,
		maxCellCount: 60,
	},
	backgroundMaterialization: {
		maxCellCountPerSlice: 100,
	},
};

export function resolveMaterializationFromTuning(
	tuning: TwoHopVirtualListTuning,
): import("./twoHopViewPlan").TwoHopViewPlanMaterialization {
	return {
		kind: "batched",
		initial: {
			maxSectionCount: tuning.initialMaterialization.maxSectionCount,
			maxCellCount: tuning.initialMaterialization.maxCellCount,
		},
		background: {
			maxCellCountPerSlice: tuning.backgroundMaterialization.maxCellCountPerSlice,
		},
	};
}
