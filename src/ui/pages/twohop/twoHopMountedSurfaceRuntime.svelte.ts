import { getContext, untrack } from "svelte";
import type {
	MountedFlatCell,
	MountedFlatItemCell,
} from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
import { useVirtualList } from "ui/components/common/virtual-list/svelte/useVirtualList.svelte";
import { resolveVirtualizedItemVisibilityForPreviewRange } from "ui/components/common/virtual-list/svelte/virtualizedItemVisibilityState.svelte";
import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";
import type { VirtualizedItemVisibility } from "ui/components/common/virtual-list/types";
import type { TwoHopMountedRowsBuild } from "./twoHopMountedRowBuild";
import type { TwoHopViewPlanRowModel } from "./twoHopViewPlan";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import { createTwoHopMountRuntime } from "./twoHopMountRuntime.svelte";
import type { TwoHopVirtualListPlanRuntime } from "./twoHopVirtualListPlanRuntime.svelte";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";

const EMPTY_MOUNTED_ROWS: readonly [] = [];

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
	const virtualList = useVirtualList<
		import("ui/components/common/virtual-list/logicalCell").VirtualListLogicalCell<TwoHopVirtualListItem>,
		TwoHopViewPlanRowModel,
		MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
		TwoHopMountedRowsBuild
	>({
		buildMountedCells: (buildParams) => mountRuntime.buildMountedRows(buildParams),
		visibilityMetadataPolicy: { type: "caller-managed" },
		trackMountedCellsForChange: false,
		onStableVisibleRange: params.onStableVisibleRange,
		onSnapshotUpdated: (snapshot, reconciliationState) => {
			mountRuntime.syncSnapshot(
				reconciliationState.mountedBuild,
				snapshot.ranges.previewVisible,
			);
			if (mountRuntime.consumeMountedRowsChange()) {
				mountedRowsVersion += 1;
			}
		},
	});
	const mountedBuild = $derived(virtualList.getReconciliationState().mountedBuild);
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
	let mountedRowsVersion = $state.raw(0);
	const mountedRowsForSurface = $derived.by(() => {
		const build = mountedBuild;
		void mountedRowsVersion;

		if (!build) {
			return EMPTY_MOUNTED_ROWS;
		}

		return mountRuntime.getMountedRows();
	});

	const createItemRenderArgs = (
		renderedCell: MountedFlatItemCell<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		>,
		observerRoot: HTMLElement | null,
	): {
		item: TwoHopVirtualListItem;
		section: TwoHopVirtualListSection;
		index: number;
		rowIndex: number;
		observerRoot: HTMLElement | null;
		visibilityState: VirtualizedItemVisibilityState;
		readonly visibility: VirtualizedItemVisibility;
		activationCandidateId: string;
	} => {
		const visibilityState = mountRuntime.getOrCreateVisibilityState(
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
			item: renderedCell.cell.item,
			section: renderedCell.section,
			index: renderedCell.cell.itemIndex,
			rowIndex: renderedCell.rowIndex,
			observerRoot,
			visibilityState,
			activationCandidateId: renderedCell.key,
			get visibility() {
				return visibilityState.visibility;
			},
		};
	};

	return {
		mountRuntime,
		virtualList,
		get contentHeight() {
			return contentHeight;
		},
		get mountedRowsVersion() {
			return mountedRowsVersion;
		},
		get mountedRowsForSurface() {
			return mountedRowsForSurface;
		},
		createItemRenderArgs,
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
