import { getContext, untrack } from "svelte";
import type {
	MountedFlatCell,
	MountedFlatItemCell,
} from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import { useVirtualList } from "ui/components/common/virtual-list/svelte/useVirtualList.svelte";
import { resolveVirtualizedItemVisibilityForPreviewRange } from "ui/components/common/virtual-list/svelte/virtualizedItemVisibilityState.svelte";
import type {
	TwoHopMountedRowSlice,
	TwoHopMountedRowsBuild,
} from "./twoHopMountedRowBuild";
import type { TwoHopViewPlan, TwoHopViewPlanRowModel } from "./twoHopViewPlan";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import { createTwoHopMountRuntime } from "./twoHopMountRuntime.svelte";
import { VirtualSurfaceRowSlot } from "ui/components/common/virtual-list/svelte/VirtualSurfaceRowSlot.svelte";
import type { TwoHopVirtualListPlanRuntime } from "./twoHopVirtualListPlanRuntime.svelte";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";

const EMPTY_MOUNTED_ROWS: readonly [] = [];
const TRAILING_EMPTY_ROW_SLOT_TRIM_THRESHOLD = 8;

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;
type TwoHopMountedRowSlot = VirtualSurfaceRowSlot<
	MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>
>;

// Activation candidates are slot-scoped; CardPreviewGate keeps the logical
// preview identity in activationKey.
function getTwoHopActivationCandidateId(cell: TwoHopMountedItemCell): string {
	return `slot:${cell.cellSlotKey ?? cell.renderSlotIndex}`;
}

export function createTwoHopMountedSurfaceRuntime(params: {
	readonly inputRuntime: TwoHopVirtualListPlanRuntime;
	onStableVisibleRange(): void;
}) {
	const rowPreviewActivationRuntime = getContext<
		RowPreviewActivationRuntime | undefined
	>(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY);
	const mountRuntime = createTwoHopMountRuntime({
		rowPreviewActivationRuntime,
	});
	let mountedRowSlots = $state.raw<readonly TwoHopMountedRowSlot[]>([]);
	let lastMountedRowSlotPlan: TwoHopViewPlan | undefined;

	function resolveRowSlotIndex(row: TwoHopMountedRowSlice): number {
		return row.slotIndex ?? row.rowIndex;
	}

	function ensureRowSlotCapacity(maxSlotIndex: number): boolean {
		if (maxSlotIndex < mountedRowSlots.length) return false;
		const nextSlots = mountedRowSlots.slice();
		for (let index = nextSlots.length; index <= maxSlotIndex; index += 1) {
			nextSlots.push(new VirtualSurfaceRowSlot(index));
		}
		mountedRowSlots = nextSlots;
		return true;
	}

	function trimTrailingEmptyRowSlotsToLength(nextLength: number): boolean {
		const clampedLength = Math.max(0, Math.min(nextLength, mountedRowSlots.length));
		if (clampedLength === mountedRowSlots.length) return false;
		mountedRowSlots = mountedRowSlots.slice(0, clampedLength);
		return true;
	}

	function resolveMaxActiveRowSlotIndex(
		rows: readonly TwoHopMountedRowSlice[],
	): number {
		let maxSlotIndex = -1;
		for (const row of rows) {
			maxSlotIndex = Math.max(maxSlotIndex, resolveRowSlotIndex(row));
		}
		return maxSlotIndex;
	}

	function hasPlanStructureChanged(
		previous: TwoHopViewPlan,
		next: TwoHopViewPlan,
	): boolean {
		if (previous.columns !== next.columns) return true;
		if (previous.sections.length !== next.sections.length) return true;

		for (let index = 0; index < previous.sections.length; index += 1) {
			const previousSection = previous.sections[index];
			const nextSection = next.sections[index];
			if (
				previousSection.sectionId !== nextSection.sectionId ||
				previousSection.firstRowIndex !== nextSection.firstRowIndex ||
				previousSection.rowCount !== nextSection.rowCount ||
				previousSection.cellCount !== nextSection.cellCount
			) {
				return true;
			}
		}

		return false;
	}

	function consumePlanStructureTrimRequest(build: TwoHopMountedRowsBuild): boolean {
		const previousPlan = lastMountedRowSlotPlan;
		lastMountedRowSlotPlan = build.plan;
		return (
			previousPlan !== undefined &&
			previousPlan !== build.plan &&
			hasPlanStructureChanged(previousPlan, build.plan)
		);
	}

	function shouldTrimTrailingEmptyRowSlots(params: {
		readonly build: TwoHopMountedRowsBuild;
		readonly maxActiveSlotIndex: number;
		readonly forceForPlanStructureChange: boolean;
	}): boolean {
		if (mountedRowSlots.length === 0) return false;
		if (params.build.plan.rowCount === 0 || params.build.rowSlices.length === 0) {
			return true;
		}
		if (params.forceForPlanStructureChange) return true;

		const retainedLength = params.maxActiveSlotIndex + 1;
		const trailingEmptySlotCount = mountedRowSlots.length - retainedLength;
		return trailingEmptySlotCount >= TRAILING_EMPTY_ROW_SLOT_TRIM_THRESHOLD;
	}

	function applyRowSlotChanges(
		build: TwoHopMountedRowsBuild,
		changes: TwoHopMountedRowsBuild["rowSlotChanges"],
		options: {
			readonly forceTrimForPlanStructureChange: boolean;
		},
	): boolean {
		let rowChanged = false;
		const slotsChanged =
			changes.maxSlotIndex >= 0 && ensureRowSlotCapacity(changes.maxSlotIndex);
		const slots = mountedRowSlots;

		for (const row of changes.assignedRows) {
			const slotIndex = resolveRowSlotIndex(row);
			const slot = slots[slotIndex];
			if (!slot) continue;
			rowChanged = slot.setRow(row) || rowChanged;
		}

		for (const slotIndex of changes.clearedSlotIndices) {
			const slot = slots[slotIndex];
			if (!slot) continue;
			rowChanged = slot.setRow(null) || rowChanged;
		}

		const maxActiveSlotIndex = resolveMaxActiveRowSlotIndex(build.rowSlices);
		const slotsTrimmed = shouldTrimTrailingEmptyRowSlots({
			build,
			maxActiveSlotIndex,
			forceForPlanStructureChange: options.forceTrimForPlanStructureChange,
		})
			? trimTrailingEmptyRowSlotsToLength(maxActiveSlotIndex + 1)
			: false;
		return slotsChanged || rowChanged || slotsTrimmed;
	}

	const virtualList = useVirtualList<
		import("ui/components/common/virtual-list/logicalCell").VirtualListLogicalCell<TwoHopVirtualListItem>,
		TwoHopViewPlanRowModel,
		MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
		TwoHopMountedRowsBuild
	>({
		buildMountedCells: (buildParams) => mountRuntime.buildMountedRows(buildParams),
		visibilityMetadataPolicy: { type: "caller-managed" },
		providePreviousCellsByKey: false,
		trackMountedCellsForChange: false,
		onStableVisibleRange: params.onStableVisibleRange,
		onSnapshotUpdated: (snapshot, reconciliationState) => {
			mountRuntime.syncSnapshot(
				reconciliationState.mountedBuild,
				snapshot.ranges.previewVisible,
			);
			if (reconciliationState.mountedBuild === null) {
				mountRuntime.resetMountedRows();
				lastMountedRowSlotPlan = undefined;
				if (mountedRowSlots.length > 0) {
					mountedRowSlots = [];
				}
				return;
			}
			const forceTrimForPlanStructureChange = consumePlanStructureTrimRequest(
				reconciliationState.mountedBuild,
			);
			if (mountRuntime.consumeMountedRowsChange()) {
				applyRowSlotChanges(
					reconciliationState.mountedBuild,
					mountRuntime.getMountedRowSlotChanges(),
					{ forceTrimForPlanStructureChange },
				);
			} else if (forceTrimForPlanStructureChange) {
				const maxActiveSlotIndex = resolveMaxActiveRowSlotIndex(
					reconciliationState.mountedBuild.rowSlices,
				);
				trimTrailingEmptyRowSlotsToLength(maxActiveSlotIndex + 1);
			}
		},
	});
	const contentHeight = $derived.by(() => {
		const activeRowModel = params.inputRuntime.rowModel;
		const snapshot = virtualList.getSnapshot();

		if (!snapshot) {
			return activeRowModel.totalHeight;
		}

		if (snapshot.rowModel !== activeRowModel) {
			return Math.max(snapshot.totalHeight, activeRowModel.totalHeight);
		}

		return snapshot.totalHeight;
	});
	const getItemVisibilityState = (renderedCell: TwoHopMountedItemCell) =>
		mountRuntime.getOrCreateVisibilityState(
			renderedCell,
			untrack(() => {
				const previewVisible = virtualList.getSnapshot()?.ranges.previewVisible;
				return previewVisible
					? resolveVirtualizedItemVisibilityForPreviewRange(
							renderedCell.rowIndex,
							previewVisible,
						)
					: "mounted";
			}),
		);

	return {
		mountRuntime,
		virtualList,
		get contentHeight() {
			return contentHeight;
		},
		get mountedRowsForSurface() {
			const build = virtualList.getReconciliationState().mountedBuild;
			if (!build) return EMPTY_MOUNTED_ROWS;
			return mountRuntime.getMountedRows();
		},
		get mountedRowSlotsForSurface() {
			return mountedRowSlots;
		},
		getItemVisibilityState,
		getItemActivationCandidateId: getTwoHopActivationCandidateId,
		syncPreviewVisibleRange(start: number, end: number) {
			mountRuntime.schedulePreviewRangeSync(
				virtualList.getReconciliationState().mountedBuild,
				start,
				end,
			);
		},
		cancelPreviewVisibleRangeSync() {
			mountRuntime.cancelScheduledSync();
		},
	};
}

export type TwoHopMountedSurfaceRuntime = ReturnType<
	typeof createTwoHopMountedSurfaceRuntime
>;
