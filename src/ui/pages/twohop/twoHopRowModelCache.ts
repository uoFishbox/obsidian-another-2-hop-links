import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { TwoHopVirtualSectionDescriptor } from "./twoHopVirtualListModel";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	type TwoHopViewPlanMaterialization,
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";

export interface TwoHopRowModelCache {
	resolve(
		sections: readonly TwoHopVirtualSectionDescriptor[],
		sectionVisibleCounts: Readonly<Record<string, number>>,
		layout: ViewPlanLayoutMetrics,
	): TwoHopViewPlanRowModel;
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
