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
import type { TwoHopViewPlanRowModel } from "./twoHopViewPlan";
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

	function applyRowSlotChanges(
		changes: TwoHopMountedRowsBuild["rowSlotChanges"],
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

		return slotsChanged || rowChanged;
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
				if (mountedRowSlots.length > 0) {
					mountedRowSlots = [];
				}
				return;
			}
			if (mountRuntime.consumeMountedRowsChange()) {
				applyRowSlotChanges(mountRuntime.getMountedRowSlotChanges());
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
