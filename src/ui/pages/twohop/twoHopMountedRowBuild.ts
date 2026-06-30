import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { VirtualRanges } from "ui/components/common/virtual-list/types";
import type { MountedFlatCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/core/reconciliation/viewPlanRenderRows";
import {
	buildSectionedGridMountedRows,
	type SectionedGridMountedRowsBuild,
	type SectionedGridResolvedRowScratch,
} from "ui/components/common/virtual-list/row-models/sectionedGridMountedRows";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import {
	ensureTwoHopMountedRangeMaterialized,
	findTwoHopSectionIndexByRow,
	readTwoHopLogicalCellInSection,
	resolveTwoHopRowInSection,
	resolveTwoHopRowInSectionInto,
	type TwoHopViewPlan,
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";

/**
 * Materializes only the row ranges in `next` that are not covered by
 * `previous`. When the two ranges form a contiguous scroll (e.g.
 * [10, 19) → [11, 20)), only the trailing or leading tail is walked.
 * When the ranges do not overlap at all (non-contiguous jump), the full
 * `next` range is materialized as a safe fallback.
 *
 * Does nothing when the ranges are identical.
 */
function materializeDiffRows(
	plan: TwoHopViewPlan,
	previous: RowRange,
	next: RowRange,
): void {
	const forwardStart = Math.max(next.start, previous.end);
	const forwardEnd = next.end;
	const backwardStart = next.start;
	const backwardEnd = Math.min(next.end, previous.start);

	// Forward tail: rows entering at the trailing edge.
	if (forwardStart < forwardEnd) {
		ensureTwoHopMountedRangeMaterialized(plan, {
			start: forwardStart,
			end: forwardEnd,
		});
	}
	// Backward tail: rows entering at the leading edge.
	if (backwardStart < backwardEnd) {
		ensureTwoHopMountedRangeMaterialized(plan, {
			start: backwardStart,
			end: backwardEnd,
		});
	}
}

export type TwoHopMountedRowsBuild = SectionedGridMountedRowsBuild<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
	TwoHopViewPlan
>;

export type TwoHopMountedCell = MountedFlatCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

export type TwoHopMountedRowSlice = MountedFlatRowSlice<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

/**
 * Assigns compiled TwoHop cells directly to pooled surface slots.
 *
 * When the previous build used the same plan object, only the row ranges
 * that are new relative to the previous mounted range are materialized.
 * This avoids re-walking the entire range on every small scroll step.
 * Non-contiguous jumps (no overlap with the previous range) fall back to
 * full materialization of the new range.
 */
export function buildTwoHopMountedRows(params: {
	readonly rowModel: TwoHopViewPlanRowModel;
	readonly rowRange: RowRange;
	readonly ranges: VirtualRanges;
	readonly previousBuild?: TwoHopMountedRowsBuild;
	readonly reusableRowSlotsScratch?: number[];
	readonly resolvedRowScratch?: SectionedGridResolvedRowScratch;
}): TwoHopMountedRowsBuild {
	const plan = params.rowModel.plan;
	const range = params.rowRange;
	const previous = params.previousBuild;

	// Materialize the cells for the mounted range before the pure builder
	// reads them, so the generic builder has a single responsibility: convert
	// a row range into mounted rows.
	if (previous !== undefined && previous.plan === plan) {
		const prevRange = previous.rowRange;
		if (range.start === prevRange.start && range.end === prevRange.end) {
			// Same range, same plan — no materialization needed.
		} else {
			// Check if the new range overlaps with the previous range.
			// Contiguous scroll produces an overlap or adjacency; a jump
			// produces no overlap at all.
			const overlapStart = Math.max(range.start, prevRange.start);
			const overlapEnd = Math.min(range.end, prevRange.end);
			if (overlapStart < overlapEnd) {
				// Overlapping — materialize only the diff tails.
				materializeDiffRows(plan, prevRange, range);
			} else {
				// Non-contiguous jump — fall back to full materialization.
				ensureTwoHopMountedRangeMaterialized(plan, range);
			}
		}
	} else {
		// Different plan (or no previous build) — full materialization.
		ensureTwoHopMountedRangeMaterialized(plan, range);
	}

	return buildSectionedGridMountedRows({
		plan,
		rowRange: range,
		previousBuild: previous,
		reusableRowSlotsScratch: params.reusableRowSlotsScratch,
		resolvedRowScratch: params.resolvedRowScratch,
		findSectionIndexByRow: findTwoHopSectionIndexByRow,
		resolveRowInSection: resolveTwoHopRowInSection,
		resolveRowInSectionInto: resolveTwoHopRowInSectionInto,
		readLogicalCellInSection: readTwoHopLogicalCellInSection,
	});
}
