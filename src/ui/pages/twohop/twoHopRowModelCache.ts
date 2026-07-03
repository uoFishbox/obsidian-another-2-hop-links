import {
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { TwoHopVirtualSectionDescriptor } from "./twoHopVirtualListModel";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	type TwoHopViewPlanMaterialization,
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { IS_PROD } from "appConstants";

export interface TwoHopRowModelCache {
	resolve(
		sections: readonly TwoHopVirtualSectionDescriptor[],
		sectionVisibleCounts: Readonly<Record<string, number>>,
		layout: ViewPlanLayoutMetrics,
	): TwoHopViewPlanRowModel;
}

function hasSameVisibleCounts(
	current: Readonly<Record<string, number>>,
	next: Readonly<Record<string, number>>,
): boolean {
	const currentKeys = Object.keys(current);
	const nextKeys = Object.keys(next);
	if (currentKeys.length !== nextKeys.length) {
		return false;
	}

	for (const key of currentKeys) {
		if (current[key] !== next[key]) {
			return false;
		}
	}
	return true;
}

export function createTwoHopRowModelCache(params: {
	readonly materialization: TwoHopViewPlanMaterialization;
	resolveInitialSectionVisibleCount(section: TwoHopVirtualSectionDescriptor): number;
	clampVisibleCount(section: TwoHopVirtualSectionDescriptor, count: number): number;
}): TwoHopRowModelCache {
	let previousSections: readonly TwoHopVirtualSectionDescriptor[] | undefined;
	let previousVisibleCounts: Readonly<Record<string, number>> | undefined;
	let previousLayout: ViewPlanLayoutMetrics | undefined;
	let previousRowModel: TwoHopViewPlanRowModel | undefined;

	return {
		resolve(sections, sectionVisibleCounts, layout) {
			const hasSemanticallySameLayout =
				previousLayout !== undefined &&
				isSameViewPlanLayout(previousLayout, layout);
			const hasCacheCompatibleLayout =
				previousLayout !== undefined &&
				(layout === previousLayout || hasSemanticallySameLayout);

			if (
				previousRowModel &&
				sections === previousSections &&
				sectionVisibleCounts === previousVisibleCounts &&
				hasCacheCompatibleLayout
			) {
				if (!IS_PROD) {
					recordCCLDevMeasurement("twoHop.rowModelCache.hit");
				}
				return previousRowModel;
			}

			if (!IS_PROD) {
				recordCCLDevMeasurement("twoHop.rowModelCache.miss");
				if (!previousRowModel) {
					recordCCLDevMeasurement("twoHop.rowModelCache.miss.firstResolve");
				} else {
					if (sections !== previousSections) {
						recordCCLDevMeasurement("twoHop.rowModelCache.miss.sections");
					}
					if (sectionVisibleCounts !== previousVisibleCounts) {
						recordCCLDevMeasurement(
							"twoHop.rowModelCache.miss.visibleCounts",
						);
						if (
							previousVisibleCounts &&
							hasSameVisibleCounts(
								previousVisibleCounts,
								sectionVisibleCounts,
							)
						) {
							recordCCLDevMeasurement(
								"twoHop.rowModelCache.miss.visibleCountsSemanticallySame",
							);
						}
					}
					if (!hasCacheCompatibleLayout) {
						recordCCLDevMeasurement("twoHop.rowModelCache.miss.layout");
					} else if (layout !== previousLayout) {
						recordCCLDevMeasurement(
							"twoHop.rowModelCache.miss.layoutSemanticallySame",
						);
					}
				}
			}

			const rowModel = createTwoHopViewPlanRowModel(
				compileTwoHopViewPlan({
					sections,
					sectionVisibleCounts,
					layout,
					materialization: params.materialization,
					resolveInitialSectionVisibleCount:
						params.resolveInitialSectionVisibleCount,
					clampVisibleCount: params.clampVisibleCount,
				}),
			);
			previousSections = sections;
			previousVisibleCounts = sectionVisibleCounts;
			previousLayout = layout;
			previousRowModel = rowModel;
			return rowModel;
		},
	};
}
