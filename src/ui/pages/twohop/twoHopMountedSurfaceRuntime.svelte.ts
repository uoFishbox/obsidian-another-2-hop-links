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
	let mountedRowSlots = $state.raw<readonly TwoHopMountedRowSlot[]>([]);
	let activeSlotGeneration = 1;
	let activeSlotMarks = new Uint32Array(0);
	let activeSlotIndices: number[] = [];
	let nextActiveSlotIndices: number[] = [];

	function resolveRowSlotIndex(row: TwoHopMountedRowSlice): number {
		return row.slotIndex ?? row.rowIndex;
	}

	function ensureRowSlotCapacity(maxSlotIndex: number): boolean {
		if (maxSlotIndex < mountedRowSlots.length) return false;
		const nextSlots = mountedRowSlots.slice();
		for (let index = nextSlots.length; index <= maxSlotIndex; index += 1) {
			nextSlots.push(new TwoHopRowSlot(index));
		}
		mountedRowSlots = nextSlots;
		return true;
	}

	function ensureActiveSlotMarkCapacity(maxSlotIndex: number): void {
		if (maxSlotIndex < activeSlotMarks.length) return;

		const nextLength = Math.max(maxSlotIndex + 1, activeSlotMarks.length * 2, 8);
		const nextMarks = new Uint32Array(nextLength);
		nextMarks.set(activeSlotMarks);
		activeSlotMarks = nextMarks;
	}

	function nextActiveSlotGeneration(): number {
		activeSlotGeneration += 1;
		if (activeSlotGeneration !== 0) return activeSlotGeneration;

		activeSlotMarks.fill(0);
		activeSlotGeneration = 1;
		return activeSlotGeneration;
	}

	function syncMountedRowSlots(rows: readonly TwoHopMountedRowSlice[]): boolean {
		let maxSlotIndex = -1;
		let rowChanged = false;
		nextActiveSlotIndices.length = 0;

		for (const row of rows) {
			maxSlotIndex = Math.max(maxSlotIndex, resolveRowSlotIndex(row));
		}

		const slotsChanged = maxSlotIndex >= 0 && ensureRowSlotCapacity(maxSlotIndex);
		if (maxSlotIndex >= 0) {
			ensureActiveSlotMarkCapacity(maxSlotIndex);
		}
		const generation = nextActiveSlotGeneration();
		const slots = mountedRowSlots;

		for (const row of rows) {
			const slotIndex = resolveRowSlotIndex(row);
			const slot = slots[slotIndex];
			activeSlotMarks[slotIndex] = generation;
			nextActiveSlotIndices.push(slotIndex);
			rowChanged = slot.setRow(row) || rowChanged;
		}

		for (const slotIndex of activeSlotIndices) {
			if (activeSlotMarks[slotIndex] === generation) continue;
			const slot = slots[slotIndex];
			if (!slot) continue;
			rowChanged = slot.setRow(null) || rowChanged;
		}

		const previousActiveSlotIndices = activeSlotIndices;
		activeSlotIndices = nextActiveSlotIndices;
		nextActiveSlotIndices = previousActiveSlotIndices;

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
