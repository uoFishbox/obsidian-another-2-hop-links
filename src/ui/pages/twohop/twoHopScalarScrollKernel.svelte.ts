import type { RowPreviewActivationRuntime } from "features/preview/scheduling/rowPreviewActivationRuntime";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { VirtualRanges } from "ui/components/common/virtual-list/types";
import {
	createMountedRangeTransitionScratch,
	planMountedRangeTransition,
	type MountedRangeTransitionInput,
} from "./twoHopMountedRangeTransition";
import { createTwoHopPhysicalSlotStore } from "./twoHopPhysicalSlotStore.svelte";
import type { TwoHopViewPlan, TwoHopViewPlanRowModel } from "./twoHopViewPlan";

export interface TwoHopScalarKernelSnapshot {
	readonly rowModel: TwoHopViewPlanRowModel;
	readonly ranges: VirtualRanges;
	readonly totalHeight: number;
}

/** Resolves ranges and commits planner output to the physical slot store. */
export function createTwoHopScalarScrollKernel(params: {
	readonly initialRowModel: TwoHopViewPlanRowModel;
	readonly rowPreviewActivationRuntime?: RowPreviewActivationRuntime;
	onStableVisibleRange(): void;
}) {
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
	const rangeScratch: VirtualRanges = {
		mounted: { start: 0, end: 0 },
		previewVisible: { start: 0, end: 0 },
	};
	const transitionScratch = createMountedRangeTransitionScratch();
	const nextMountedRangeScratch: RowRange = { start: 0, end: 0 };
	const dirtyRangeScratch: RowRange = { start: 0, end: 0 };
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
		const changed = applyResolvedRanges(input.rowModel, rangeScratch);
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
		getMountedCellByInteractionId: physicalSlotStore.getMountedCellByInteractionId,
		dispose(): void {
			physicalSlotStore.dispose();
		},
	};
}

export type TwoHopScalarScrollKernel = ReturnType<
	typeof createTwoHopScalarScrollKernel
>;
