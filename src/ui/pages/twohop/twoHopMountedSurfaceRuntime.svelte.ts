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
import { TwoHopRowSlot } from "./twoHopRowSlot.svelte";
import type { TwoHopVirtualListPlanRuntime } from "./twoHopVirtualListPlanRuntime.svelte";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";

const EMPTY_MOUNTED_ROWS: readonly [] = [];
const EMPTY_ROW_SLOT_INDICES: readonly number[] = [];

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;
type TwoHopMountedRowSlot = TwoHopRowSlot<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
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
	const activeSlotIndexScratch = new Set<number>();
	const nextActiveSlotIndicesScratch: number[] = [];
	let mountedRowSlots = $state.raw<readonly TwoHopMountedRowSlot[]>([]);
	let activeSlotIndices: readonly number[] = EMPTY_ROW_SLOT_INDICES;

	const ensureRowSlot = (
		slotIndex: number,
	): {
		readonly slots: readonly TwoHopMountedRowSlot[];
		readonly changed: boolean;
	} => {
		if (mountedRowSlots[slotIndex]) {
			return { slots: mountedRowSlots, changed: false };
		}

		const nextSlots = mountedRowSlots.slice();
		for (let index = nextSlots.length; index <= slotIndex; index += 1) {
			nextSlots.push(new TwoHopRowSlot(index));
		}
		return { slots: nextSlots, changed: true };
	};

	function syncMountedRowSlots(rows: readonly TwoHopMountedRowSlice[]): boolean {
		let slots = mountedRowSlots;
		let slotsChanged = false;
		let rowChanged = false;
		activeSlotIndexScratch.clear();
		nextActiveSlotIndicesScratch.length = 0;

		for (const row of rows) {
			const slotIndex = row.slotIndex ?? row.rowIndex;
			const ensured = slots[slotIndex]
				? { slots, changed: false }
				: ensureRowSlot(slotIndex);
			if (ensured.changed) {
				slots = ensured.slots;
				mountedRowSlots = slots;
				slotsChanged = true;
			}
			const slot = slots[slotIndex];
			activeSlotIndexScratch.add(slotIndex);
			nextActiveSlotIndicesScratch.push(slotIndex);
			rowChanged = slot.setRow(row) || rowChanged;
		}

		for (const slotIndex of activeSlotIndices) {
			if (activeSlotIndexScratch.has(slotIndex)) continue;
			const slot = slots[slotIndex];
			if (!slot) continue;
			rowChanged = slot.setRow(null) || rowChanged;
		}

		activeSlotIndices = nextActiveSlotIndicesScratch.slice();
		if (!rowChanged && rows.length > 0) {
			for (const row of rows) {
				const slotIndex = row.slotIndex ?? row.rowIndex;
				slots[slotIndex]?.refreshRow(row);
			}
			rowChanged = true;
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
			if (mountRuntime.consumeMountedRowsChange()) {
				syncMountedRowSlots(mountRuntime.getMountedRows());
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
