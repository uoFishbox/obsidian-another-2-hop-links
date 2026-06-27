import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { TwoHopVirtualListItem } from "../twoHopVirtualListModel";
import type { TwoHopCellStore, TwoHopViewPlan } from "./types";

export function createTwoHopCellStore(
	logicalCellsBySectionIndex: Array<
		Array<VirtualListLogicalCell<TwoHopVirtualListItem> | undefined>
	>,
	sectionCount: number,
	totalCellCount: number,
): TwoHopCellStore {
	return {
		logicalCellsBySectionIndex,
		materializationStateBySectionIndex: Array.from(
			{ length: sectionCount },
			() => ({
				nextCellIndex: 0,
				materializedCellCount: 0,
			}),
		),
		materializedSectionByIndex: new Array<boolean>(sectionCount).fill(false),
		nextUnmaterializedSectionIndex: 0,
		remainingUnmaterializedCellCount: totalCellCount,
		remainingUnmaterializedSectionCount: sectionCount,
		revision: 0,
	};
}

export function markTwoHopMaterializationChanged(plan: TwoHopViewPlan): void {
	plan.cellStore.revision += 1;
}

export function markTwoHopSectionMaterialized(
	plan: TwoHopViewPlan,
	sectionIndex: number,
): void {
	const cellStore = plan.cellStore;
	if (cellStore.materializedSectionByIndex[sectionIndex]) return;
	cellStore.materializedSectionByIndex[sectionIndex] = true;
	cellStore.remainingUnmaterializedSectionCount -= 1;
}

/**
 * Records that one previously-empty cell in `sectionIndex` has just been
 * materialized, regardless of which path filled it.
 *
 * This is the single transition point that advances per-section and global
 * bookkeeping. Callers must invoke it exactly once for every cell that
 * transitions from empty to filled; calling it on an already-filled cell
 * would double-count. Section completion is surfaced to the caller via the
 * returned flag so each path can run its own section-advancement logic
 * (the background loop advances its section cursor; the scroll path only
 * marks the section).
 */
export function recordTwoHopCellFilled(
	plan: TwoHopViewPlan,
	sectionIndex: number,
): boolean {
	const cellStore = plan.cellStore;
	const state = cellStore.materializationStateBySectionIndex[sectionIndex];
	const sectionPlan = plan.sections[sectionIndex];
	if (!state || !sectionPlan) return false;
	state.materializedCellCount += 1;
	cellStore.remainingUnmaterializedCellCount = Math.max(
		0,
		cellStore.remainingUnmaterializedCellCount - 1,
	);
	return state.materializedCellCount >= sectionPlan.cellCount;
}
