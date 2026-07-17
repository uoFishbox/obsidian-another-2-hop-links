import {
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { TwoHopVirtualSectionDescriptor } from "./twoHopVirtualListModel";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { TwoHopCardPresentationState } from "./twoHopCellStaticState";
import type { TwoHopVirtualListItem } from "./twoHopVirtualListModel";

/**
 * Single-entry compiled-plan cache owned by a virtual-list controller.
 *
 * Its dependencies are descriptor identity, semantic visible counts, and
 * layout metrics. A miss compiles the typed-array plan; `invalidate()` drops
 * the retained plan. It is never resolved by the scalar scroll hot path and
 * reports `twoHop.compiledPlanCache.*` counters.
 */
export interface TwoHopCompiledPlanCache {
	resolve(
		sections: readonly TwoHopVirtualSectionDescriptor[],
		sectionVisibleCounts: Readonly<Record<string, number>>,
		layout: ViewPlanLayoutMetrics,
		cardModelRevision?: unknown,
		resolveItemCardModel?: (
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel,
	): TwoHopViewPlanRowModel;
	invalidate(): void;
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

export function createTwoHopCompiledPlanCache(params: {
	resolveInitialSectionVisibleCount(section: TwoHopVirtualSectionDescriptor): number;
	clampVisibleCount(section: TwoHopVirtualSectionDescriptor, count: number): number;
}): TwoHopCompiledPlanCache {
	let previousSections: readonly TwoHopVirtualSectionDescriptor[] | undefined;
	let previousVisibleCounts: Readonly<Record<string, number>> | undefined;
	let previousLayout: ViewPlanLayoutMetrics | undefined;
	let previousCardModelRevision: unknown;
	let previousResolveItemCardModel:
		| ((
				item: TwoHopVirtualListItem,
				presentation: TwoHopCardPresentationState,
		  ) => CardRenderModel)
		| undefined;
	let previousRowModel: TwoHopViewPlanRowModel | undefined;

	return {
		resolve(
			sections,
			sectionVisibleCounts,
			layout,
			cardModelRevision,
			resolveItemCardModel,
		) {
			const hasSemanticallySameLayout =
				previousLayout !== undefined &&
				isSameViewPlanLayout(previousLayout, layout);
			const hasCacheCompatibleLayout =
				previousLayout !== undefined &&
				(layout === previousLayout || hasSemanticallySameLayout);
			const hasCompatibleVisibleCounts =
				sectionVisibleCounts === previousVisibleCounts ||
				(previousVisibleCounts !== undefined &&
					hasSameVisibleCounts(previousVisibleCounts, sectionVisibleCounts));

			if (
				previousRowModel &&
				sections === previousSections &&
				hasCompatibleVisibleCounts &&
				hasCacheCompatibleLayout &&
				cardModelRevision === previousCardModelRevision &&
				resolveItemCardModel === previousResolveItemCardModel
			) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("twoHop.rowModelCache.hit");
					recordCCLDevMeasurement("twoHop.compiledPlanCache.hit");
				}
				previousVisibleCounts = sectionVisibleCounts;
				return previousRowModel;
			}

			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.rowModelCache.miss");
				recordCCLDevMeasurement("twoHop.compiledPlanCache.miss");
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

			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.plan.compile");
			}
			const rowModel = createTwoHopViewPlanRowModel(
				compileTwoHopViewPlan({
					sections,
					sectionVisibleCounts,
					layout,
					resolveInitialSectionVisibleCount:
						params.resolveInitialSectionVisibleCount,
					clampVisibleCount: params.clampVisibleCount,
					resolveItemCardModel,
				}),
			);
			previousSections = sections;
			previousVisibleCounts = sectionVisibleCounts;
			previousLayout = layout;
			previousCardModelRevision = cardModelRevision;
			previousResolveItemCardModel = resolveItemCardModel;
			previousRowModel = rowModel;
			return rowModel;
		},
		invalidate(): void {
			previousSections = undefined;
			previousVisibleCounts = undefined;
			previousLayout = undefined;
			previousCardModelRevision = undefined;
			previousResolveItemCardModel = undefined;
			previousRowModel = undefined;
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.compiledPlanCache.invalidate");
			}
		},
	};
}
