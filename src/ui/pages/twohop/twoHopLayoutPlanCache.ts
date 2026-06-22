import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import { isScrollActivityActive } from "infrastructure/scroll/scrollActivity";
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
		onMaterialized: () => void,
	): () => void;
	cancelMaterialization(): void;
}

export function createTwoHopLayoutPlanCache(params: {
	readonly materialization: TwoHopViewPlanMaterialization;
	getWindow?: () => Window | null;
	resolveInitialSectionVisibleCount(section: TwoHopSectionDescriptor): number;
	clampVisibleCount(
		section: TwoHopSectionDescriptor,
		count: number,
	): number;
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
			const ownerWindow = params.getWindow?.() ??
				(typeof window === "undefined" ? null : window);
			if (materialization.kind !== "batched" || !ownerWindow) {
				return cancelMaterialization;
			}
			const backgroundCellCount = Number.isFinite(
				materialization.background.maxCellCountPerSlice,
			)
				? Math.max(
						0,
						Math.floor(
							materialization.background.maxCellCountPerSlice,
						),
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
			const scheduleNextBatch = (): void => {
				if (cancelled || !hasUnmaterializedTwoHopSections(plan)) return;
				if (typeof ownerWindow.requestIdleCallback === "function") {
					idleCallbackId = ownerWindow.requestIdleCallback(
						(deadline) => {
							idleCallbackId = null;
							materializeNextBatch(deadline);
						},
					);
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
			const materializeNextBatch = (deadline?: IdleDeadline): void => {
				if (cancelled) return;
				if (isScrollActivityActive()) {
					scheduleNextBatch();
					return;
				}
				if (
					materializeNextTwoHopCellBatch(plan, {
						maxCellCount: backgroundCellCount,
						shouldContinue: deadline
							? () => deadline.timeRemaining() > 1
							: undefined,
					})
				) {
					onMaterialized();
				}
				scheduleNextBatch();
			};
			const cancel = (): void => {
				cancelled = true;
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
