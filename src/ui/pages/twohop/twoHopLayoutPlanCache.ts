import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { TwoHopSectionDescriptor } from "./twohopPageVirtualModel";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	type TwoHopViewPlanMaterialization,
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";

export interface TwoHopLayoutPlanCache {
	resolve(
		sections: readonly TwoHopSectionDescriptor[],
		sectionVisibleCounts: Readonly<Record<string, number>>,
		layout: ViewPlanLayoutMetrics,
	): TwoHopViewPlanRowModel;
}

export function createTwoHopLayoutPlanCache(params: {
	readonly materialization: TwoHopViewPlanMaterialization;
	resolveInitialSectionVisibleCount(section: TwoHopSectionDescriptor): number;
	clampVisibleCount(section: TwoHopSectionDescriptor, count: number): number;
}): TwoHopLayoutPlanCache {
	let previousSections: readonly TwoHopSectionDescriptor[] | undefined;
	let previousVisibleCounts: Readonly<Record<string, number>> | undefined;
	let previousLayout: ViewPlanLayoutMetrics | undefined;
	let previousRowModel: TwoHopViewPlanRowModel | undefined;

	return {
		resolve(sections, sectionVisibleCounts, layout) {
			if (
				previousRowModel &&
				sections === previousSections &&
				sectionVisibleCounts === previousVisibleCounts &&
				layout === previousLayout
			) {
				return previousRowModel;
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
