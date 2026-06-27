import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "infrastructure/scroll/scrollActivity";
import {
	hasUnmaterializedTwoHopSections,
	materializeNextTwoHopCellBatch,
	type TwoHopViewPlanMaterialization,
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";

export type TwoHopMaterializationCancelFn = () => void;

export interface TwoHopMaterializationScheduler {
	schedule(
		rowModel: TwoHopViewPlanRowModel,
		/**
		 * Invoked with the global row range that gained newly materialized
		 * cells (or `null` when no rows changed). Callers can short-circuit a
		 * synchronous recompute when the affected range does not intersect the
		 * currently mounted rows.
		 */
		onMaterialized: (affectedRowRange: RowRange | null) => void,
	): TwoHopMaterializationCancelFn;
	cancel(): void;
}

export function createTwoHopMaterializationScheduler(params: {
	readonly materialization: TwoHopViewPlanMaterialization;
	getWindow?: () => Window | null;
}): TwoHopMaterializationScheduler {
	let cancelActiveMaterialization: TwoHopMaterializationCancelFn | undefined;

	const cancel = (): void => {
		cancelActiveMaterialization?.();
		cancelActiveMaterialization = undefined;
	};

	return {
		schedule(rowModel, onMaterialized) {
			cancel();
			const materialization = params.materialization;
			const ownerWindow =
				params.getWindow?.() ?? (typeof window === "undefined" ? null : window);
			if (materialization.kind !== "batched" || !ownerWindow) {
				return cancel;
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
				return cancel;
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
			const cancelScheduledMaterialization = (): void => {
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
			cancelActiveMaterialization = cancelScheduledMaterialization;
			scheduleNextBatch();
			return cancelScheduledMaterialization;
		},
		cancel,
	};
}
