import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import { isScrollActivityActive, subscribeScrollActivity } from "infrastructure/scroll/scrollActivity";
import type { TwoHopSectionDescriptor } from "./twohopPageVirtualModel";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	hasUnmaterializedTwoHopSections,
	materializeNextTwoHopCellBatch,
	type TwoHopViewPlanMaterialization,
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";

export interface TwoHopLayoutPlanCache {
	resolve(
		sections: readonly TwoHopSectionDescriptor[],
		sectionVisibleCounts: Readonly<Record<string, number>>,
		layout: ViewPlanLayoutMetrics,
	): TwoHopViewPlanRowModel;
	scheduleMaterialization(
		rowModel: TwoHopViewPlanRowModel,
		/**
		 * Invoked with the global row range that gained newly materialized
		 * cells (or `null` when no rows changed). Callers can short-circuit a
		 * synchronous recompute when the affected range does not intersect the
		 * currently mounted rows.
		 */
		onMaterialized: (affectedRowRange: RowRange | null) => void,
	): () => void;
	cancelMaterialization(): void;
}

export function createTwoHopLayoutPlanCache(params: {
	readonly materialization: TwoHopViewPlanMaterialization;
	getWindow?: () => Window | null;
	resolveInitialSectionVisibleCount(section: TwoHopSectionDescriptor): number;
	clampVisibleCount(section: TwoHopSectionDescriptor, count: number): number;
}): TwoHopLayoutPlanCache {
	let previousSections: readonly TwoHopSectionDescriptor[] | undefined;
	let previousVisibleCounts: Readonly<Record<string, number>> | undefined;
	let previousLayout: ViewPlanLayoutMetrics | undefined;
	let previousRowModel: TwoHopViewPlanRowModel | undefined;
	let cancelActiveMaterialization: (() => void) | undefined;

	const cancelMaterialization = (): void => {
		cancelActiveMaterialization?.();
		cancelActiveMaterialization = undefined;
	};

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

			cancelMaterialization();
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
		scheduleMaterialization(rowModel, onMaterialized) {
			cancelMaterialization();
			const materialization = params.materialization;
			const ownerWindow =
				params.getWindow?.() ?? (typeof window === "undefined" ? null : window);
			if (materialization.kind !== "batched" || !ownerWindow) {
				return cancelMaterialization;
			}
			const backgroundCellCount = Number.isFinite(
				materialization.background.maxCellCountPerSlice,
			)
				? Math.max(
						0,
						Math.floor(materialization.background.maxCellCountPerSlice),
					)
				: 0;
			if (backgroundCellCount === 0) {
				return cancelMaterialization;
			}

			const plan = rowModel.plan;
			let cancelled = false;
			let idleCallbackId: number | null = null;
			let animationFrameId: number | null = null;
			let timeoutId: number | null = null;
			let unsubScrollActivity: (() => void) | undefined;
			const scheduleNextBatch = (): void => {
				if (cancelled || !hasUnmaterializedTwoHopSections(plan)) return;
				if (typeof ownerWindow.requestIdleCallback === "function") {
					idleCallbackId = ownerWindow.requestIdleCallback((deadline) => {
						idleCallbackId = null;
						materializeNextBatch(deadline);
					});
					return;
				}
				animationFrameId = ownerWindow.requestAnimationFrame(() => {
					animationFrameId = null;
					timeoutId = ownerWindow.setTimeout(() => {
						timeoutId = null;
						materializeNextBatch();
					}, 0);
				});
			};
			const pauseForScrollActivity = (): void => {
				if (unsubScrollActivity) return;
				unsubScrollActivity = subscribeScrollActivity((isActive) => {
					if (!isActive) {
						unsubScrollActivity?.();
						unsubScrollActivity = undefined;
						scheduleNextBatch();
					}
				});
			};
			const materializeNextBatch = (deadline?: IdleDeadline): void => {
				if (cancelled) return;
				if (isScrollActivityActive()) {
					pauseForScrollActivity();
					return;
				}
				const result = materializeNextTwoHopCellBatch(plan, {
					maxCellCount: backgroundCellCount,
					shouldContinue: deadline
						? () => deadline.timeRemaining() > 1
						: undefined,
				});
				if (result.changed) {
					onMaterialized(result.affectedRowRange);
				}
				scheduleNextBatch();
			};
			const cancel = (): void => {
				cancelled = true;
				unsubScrollActivity?.();
				unsubScrollActivity = undefined;
				if (idleCallbackId !== null) {
					ownerWindow.cancelIdleCallback(idleCallbackId);
				}
				if (animationFrameId !== null) {
					ownerWindow.cancelAnimationFrame(animationFrameId);
				}
				if (timeoutId !== null) {
					ownerWindow.clearTimeout(timeoutId);
				}
			};
			cancelActiveMaterialization = cancel;
			scheduleNextBatch();
			return cancel;
		},
		cancelMaterialization,
	};
}
