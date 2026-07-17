import type { RowPreviewActivationRuntime } from "features/preview/scheduling/rowPreviewActivationRuntime";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { createPostPaintVirtualListTask } from "ui/components/common/virtual-list/dom/virtualListScheduler";
import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { VirtualRanges } from "ui/components/common/virtual-list/types";
import {
	createMountedRangeTransitionScratch,
	planMountedRangeTransition,
	type MountedRangeTransitionInput,
} from "./twoHopMountedRangeTransition";
import { createTwoHopPhysicalSlotStore } from "./twoHopPhysicalSlotStore.svelte";
import type { TwoHopViewPlan, TwoHopViewPlanRowModel } from "./twoHopViewPlan";
import {
	planResidentWindow,
	type ResidentScrollDirection,
} from "./residentWindowPlanner";

export interface TwoHopScalarKernelSnapshot {
	readonly rowModel: TwoHopViewPlanRowModel;
	readonly ranges: VirtualRanges;
	readonly totalHeight: number;
}

/** Resolves ranges and commits planner output to the physical slot store. */
export function createTwoHopScalarScrollKernel(params: {
	readonly initialRowModel: TwoHopViewPlanRowModel;
	readonly rowPreviewActivationRuntime?: RowPreviewActivationRuntime;
	readonly enableResidentWindow?: boolean;
	onStableVisibleRange(): void;
}) {
	const enableResidentWindow = params.enableResidentWindow ?? false;
	const physicalSlotStore = createTwoHopPhysicalSlotStore({
		rowPreviewActivationRuntime: params.rowPreviewActivationRuntime,
	});
	let rowModel = $state.raw(params.initialRowModel);
	const mountedRange = $state({ start: 0, end: 0 });
	const previewRange = $state({ start: 0, end: 0 });
	const ranges: VirtualRanges = {
		mounted: mountedRange,
		previewVisible: previewRange,
	};
	let initialized = false;
	let activePlan: TwoHopViewPlan | null = null;
	let pendingDirtyStart = Number.POSITIVE_INFINITY;
	let pendingDirtyEnd = Number.NEGATIVE_INFINITY;
	let lastLocalScrollTop: number | null = null;
	let residentDirection: ResidentScrollDirection = "none";
	let residentVisibleStart = 0;
	let residentVisibleEnd = 0;
	const rangeScratch: VirtualRanges = {
		mounted: { start: 0, end: 0 },
		previewVisible: { start: 0, end: 0 },
	};
	const transitionScratch = createMountedRangeTransitionScratch();
	const nextMountedRangeScratch: RowRange = { start: 0, end: 0 };
	const dirtyRangeScratch: RowRange = { start: 0, end: 0 };
	const strictVisibleRangeScratch: RowRange = { start: 0, end: 0 };
	const transitionInput: MountedRangeTransitionInput = {
		previous: mountedRange,
		next: nextMountedRangeScratch,
		dirty: dirtyRangeScratch,
		planChanged: false,
		poolChanged: false,
		capacity: 0,
	};

	const snapshot: TwoHopScalarKernelSnapshot = {
		get rowModel() {
			return rowModel;
		},
		ranges,
		get totalHeight() {
			return rowModel.totalHeight;
		},
	};

	const skippedResult = {
		kind: "skipped",
		reason: "unstable",
		updateKind: "skipped",
	} as const;
	const bootstrappedRecomputedResult = {
		kind: "bootstrapped",
		range: mountedRange,
		updateKind: "recomputed",
	} as const;
	const stableRecomputedResult = {
		kind: "stable",
		range: mountedRange,
		updateKind: "recomputed",
	} as const;
	const stableReusedResult = {
		kind: "stable",
		range: mountedRange,
		updateKind: "reused",
	} as const;
	const residentRefillTask = createPostPaintVirtualListTask(
		() => {
			refillResidentOnce();
		},
		2,
	);

	function bindRange(plan: TwoHopViewPlan, start: number, end: number): void {
		for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
			physicalSlotStore.bindRow(plan, rowIndex);
		}
	}

	function clearRange(start: number, end: number): void {
		for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
			physicalSlotStore.clearRow(rowIndex);
		}
	}

	function applyMountedRange(
		plan: TwoHopViewPlan,
		nextStart: number,
		nextEnd: number,
	): boolean {
		const planChanged = activePlan !== plan;
		const preparation = physicalSlotStore.prepareCapacity(
			nextStart,
			nextEnd,
			plan.layout,
			plan.columns,
		);
		nextMountedRangeScratch.start = nextStart;
		nextMountedRangeScratch.end = nextEnd;
		dirtyRangeScratch.start = pendingDirtyStart;
		dirtyRangeScratch.end = pendingDirtyEnd;
		transitionInput.planChanged = planChanged;
		transitionInput.poolChanged = preparation.poolChanged;
		transitionInput.capacity = preparation.capacity;
		const transition = planMountedRangeTransition(
			transitionScratch,
			transitionInput,
		);
		if (!transition.shouldCommit) return false;

		if (transition.clearAll) {
			physicalSlotStore.clearAll();
		} else if (transition.rebindAll) {
			if (transition.clearOutsideNextRange) {
				physicalSlotStore.clearOutsideRange(nextStart, nextEnd);
			} else {
				physicalSlotStore.clearAll();
			}
			bindRange(plan, nextStart, nextEnd);
		} else {
			bindRange(
				plan,
				transition.enteringLeadingStart,
				transition.enteringLeadingEnd,
			);
			bindRange(
				plan,
				transition.enteringTrailingStart,
				transition.enteringTrailingEnd,
			);
			bindRange(plan, transition.dirtyStart, transition.dirtyEnd);
			clearRange(transition.leavingLeadingStart, transition.leavingLeadingEnd);
			clearRange(transition.leavingTrailingStart, transition.leavingTrailingEnd);
		}

		activePlan = plan;
		pendingDirtyStart = Number.POSITIVE_INFINITY;
		pendingDirtyEnd = Number.NEGATIVE_INFINITY;
		mountedRange.start = nextStart;
		mountedRange.end = nextEnd;
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("twoHop.scalarKernel.mountedRangeCommit");
		}
		return true;
	}

	function applyPreviewRange(nextStart: number, nextEnd: number): void {
		if (previewRange.start === nextStart && previewRange.end === nextEnd) return;
		previewRange.start = nextStart;
		previewRange.end = nextEnd;
		physicalSlotStore.setPreviewRange(nextStart, nextEnd);
	}

	function resolveScrollDirection(
		localScrollTop: number,
	): ResidentScrollDirection {
		const previousScrollTop = lastLocalScrollTop;
		lastLocalScrollTop = localScrollTop;
		if (previousScrollTop === null || localScrollTop === previousScrollTop) {
			return residentDirection;
		}
		residentDirection =
			localScrollTop > previousScrollTop ? "forward" : "backward";
		return residentDirection;
	}

	function findNextResidentRefillRow(): number | null {
		if (!activePlan) return null;
		if (residentDirection === "backward") {
			for (
				let rowIndex = residentVisibleStart - 1;
				rowIndex >= mountedRange.start;
				rowIndex -= 1
			) {
				if (!physicalSlotStore.isRowBound(rowIndex)) return rowIndex;
			}
			for (
				let rowIndex = residentVisibleEnd;
				rowIndex < mountedRange.end;
				rowIndex += 1
			) {
				if (!physicalSlotStore.isRowBound(rowIndex)) return rowIndex;
			}
			return null;
		}

		for (
			let rowIndex = residentVisibleEnd;
			rowIndex < mountedRange.end;
			rowIndex += 1
		) {
			if (!physicalSlotStore.isRowBound(rowIndex)) return rowIndex;
		}
		for (
			let rowIndex = residentVisibleStart - 1;
			rowIndex >= mountedRange.start;
			rowIndex -= 1
		) {
			if (!physicalSlotStore.isRowBound(rowIndex)) return rowIndex;
		}
		return null;
	}

	function hasPendingResidentWork(): boolean {
		return (
			findNextResidentRefillRow() !== null ||
			physicalSlotStore.hasBoundOutsideRange(
				mountedRange.start,
				mountedRange.end,
			)
		);
	}

	function scheduleResidentRefill(): void {
		if (!enableResidentWindow || !hasPendingResidentWork()) return;
		residentRefillTask.schedule();
	}

	function refillResidentOnce(): boolean {
		if (!enableResidentWindow || !activePlan) return false;
		const rowIndex = findNextResidentRefillRow();
		if (rowIndex !== null) {
			physicalSlotStore.bindRow(activePlan, rowIndex);
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("residentWindow.refill");
			}
			scheduleResidentRefill();
			return true;
		}
		const didClear = physicalSlotStore.clearOneOutsideRange(
			mountedRange.start,
			mountedRange.end,
		);
		if (didClear) scheduleResidentRefill();
		return didClear;
	}

	function applyResidentRanges(
		nextRowModel: TwoHopViewPlanRowModel,
		nextRanges: VirtualRanges,
		input: {
			readonly localScrollTop: number;
			readonly viewportHeight: number;
			readonly isScrollActive: boolean;
		},
	): boolean {
		rowModel = nextRowModel;
		nextRowModel.findVisibleRangeInto(strictVisibleRangeScratch, {
			scrollTop: input.localScrollTop,
			viewportHeight: input.viewportHeight,
			overscanPx: 0,
		});
		const direction = resolveScrollDirection(input.localScrollTop);
		const residentPlan = planResidentWindow({
			current: mountedRange,
			visible: strictVisibleRangeScratch,
			rowCount: nextRowModel.rowCount,
			direction,
		});
		const previousStart = mountedRange.start;
		const previousEnd = mountedRange.end;
		const planChanged = activePlan !== nextRowModel.plan;
		const preparation = physicalSlotStore.prepareCapacity(
			residentPlan.start,
			residentPlan.end,
			nextRowModel.plan.layout,
			nextRowModel.plan.columns,
		);
		if (planChanged || preparation.poolChanged) {
			physicalSlotStore.clearAll();
		}

		mountedRange.start = residentPlan.start;
		mountedRange.end = residentPlan.end;
		residentVisibleStart = strictVisibleRangeScratch.start;
		residentVisibleEnd = strictVisibleRangeScratch.end;
		activePlan = nextRowModel.plan;

		let emergencyBindCount = 0;
		for (
			let rowIndex = residentVisibleStart;
			rowIndex < residentVisibleEnd;
			rowIndex += 1
		) {
			if (!physicalSlotStore.isRowBound(rowIndex)) {
				physicalSlotStore.bindRow(nextRowModel.plan, rowIndex);
				emergencyBindCount += 1;
			}
		}

		if (process.env.NODE_ENV !== "production") {
			if (initialized && emergencyBindCount > 0) {
				for (let count = 0; count < emergencyBindCount; count += 1) {
					recordCCLDevMeasurement("residentWindow.emergencyBind");
				}
			}
			if (residentPlan.distantJump) {
				recordCCLDevMeasurement("residentWindow.distantJump");
			}
			if (
				initialized &&
				emergencyBindCount === 0 &&
				residentPlan.visibleWithinCurrent
			) {
				recordCCLDevMeasurement("residentWindow.hit");
			}
		}

		const previewLimitStart = input.isScrollActive
			? residentVisibleStart
			: mountedRange.start;
		const previewLimitEnd = input.isScrollActive
			? residentVisibleEnd
			: mountedRange.end;
		const previewStart = Math.max(
			previewLimitStart,
			nextRanges.previewVisible.start,
		);
		const previewEnd = Math.max(
			previewStart,
			Math.min(previewLimitEnd, nextRanges.previewVisible.end),
		);
		applyPreviewRange(previewStart, previewEnd);
		pendingDirtyStart = Number.POSITIVE_INFINITY;
		pendingDirtyEnd = Number.NEGATIVE_INFINITY;
		scheduleResidentRefill();
		const rangeChanged =
			previousStart !== mountedRange.start || previousEnd !== mountedRange.end;
		if ((rangeChanged || emergencyBindCount > 0) && process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("twoHop.scalarKernel.mountedRangeCommit");
		}
		return rangeChanged || emergencyBindCount > 0;
	}

	function applyResolvedRanges(
		nextRowModel: TwoHopViewPlanRowModel,
		nextRanges: VirtualRanges,
	): boolean {
		rowModel = nextRowModel;
		const mountedStart = Math.max(
			0,
			Math.min(nextRowModel.rowCount, nextRanges.mounted.start),
		);
		const mountedEnd = Math.max(
			mountedStart,
			Math.min(nextRowModel.rowCount, nextRanges.mounted.end),
		);
		const previewStart = Math.max(mountedStart, nextRanges.previewVisible.start);
		const previewEnd = Math.min(mountedEnd, nextRanges.previewVisible.end);
		applyPreviewRange(previewStart, previewEnd);
		return applyMountedRange(nextRowModel.plan, mountedStart, mountedEnd);
	}

	function applyMeasurement(input: {
		rowModel: TwoHopViewPlanRowModel;
		scrollTop: number;
		viewportHeight: number;
		sectionTop: number;
		isStableMeasurement: boolean;
		isScrollActive: boolean;
		hasStableVisibleRange: boolean;
		precomputedRanges?: VirtualRanges;
		visibilityPolicy: {
			bootstrapRows: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		};
	}) {
		if (!input.isStableMeasurement) return skippedResult;
		if (input.precomputedRanges) {
			rangeScratch.mounted.start = input.precomputedRanges.mounted.start;
			rangeScratch.mounted.end = input.precomputedRanges.mounted.end;
			rangeScratch.previewVisible.start =
				input.precomputedRanges.previewVisible.start;
			rangeScratch.previewVisible.end =
				input.precomputedRanges.previewVisible.end;
		} else {
			input.rowModel.findVisibleRangesInto(rangeScratch, {
				scrollTop: input.scrollTop - input.sectionTop,
				viewportHeight: input.viewportHeight,
				mountedOverscanPx: input.visibilityPolicy.mountedOverscanPx,
				previewOverscanPx: input.visibilityPolicy.previewOverscanPx,
			});
		}
		const changed = enableResidentWindow
			? applyResidentRanges(input.rowModel, rangeScratch, {
					localScrollTop: input.scrollTop - input.sectionTop,
					viewportHeight: input.viewportHeight,
					isScrollActive: input.isScrollActive,
				})
			: applyResolvedRanges(input.rowModel, rangeScratch);
		if (!initialized) {
			initialized = true;
			return bootstrappedRecomputedResult;
		}
		params.onStableVisibleRange();
		return changed ? stableRecomputedResult : stableReusedResult;
	}

	return {
		fixedRowSlotPool: physicalSlotStore.fixedRowSlotPool,
		get mountedRows() {
			return physicalSlotStore.mountedRows;
		},
		getSnapshot(): TwoHopScalarKernelSnapshot | null {
			return initialized ? snapshot : null;
		},
		applyMeasurement,
		recompute(input: { rowModel: TwoHopViewPlanRowModel }): void {
			if (!initialized) return;
			rangeScratch.mounted.start = mountedRange.start;
			rangeScratch.mounted.end = mountedRange.end;
			rangeScratch.previewVisible.start = previewRange.start;
			rangeScratch.previewVisible.end = previewRange.end;
			applyResolvedRanges(input.rowModel, rangeScratch);
		},
		markDirtyRows(range: RowRange): void {
			pendingDirtyStart = Math.min(pendingDirtyStart, range.start);
			pendingDirtyEnd = Math.max(pendingDirtyEnd, range.end);
		},
		syncPreviewVisibleRange(start: number, end: number): void {
			applyPreviewRange(start, end);
		},
		cancelPreviewVisibleRangeSync(): void {},
		drainResidentRefill(): void {
			residentRefillTask.cancel();
			let remaining = Math.max(1, mountedRange.end - mountedRange.start + 16);
			while (remaining > 0 && refillResidentOnce()) {
				residentRefillTask.cancel();
				remaining -= 1;
			}
		},
		getMountedCellByInteractionId: physicalSlotStore.getMountedCellByInteractionId,
		dispose(): void {
			residentRefillTask.cancel();
			physicalSlotStore.dispose();
		},
	};
}

export type TwoHopScalarScrollKernel = ReturnType<
	typeof createTwoHopScalarScrollKernel
>;
