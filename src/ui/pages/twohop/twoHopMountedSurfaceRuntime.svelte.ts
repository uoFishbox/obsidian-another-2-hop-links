import { getContext, untrack } from "svelte";
import type {
	MountedFlatCell,
	MountedFlatItemCell,
} from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import { useVirtualList } from "ui/components/common/virtual-list/svelte/useVirtualList.svelte";
import { resolveVirtualizedItemVisibilityForPreviewRange } from "ui/components/common/virtual-list/svelte/virtualizedItemVisibilityState.svelte";
import type { SectionedVirtualListItemRenderArgs } from "ui/components/common/virtual-list/svelte/renderArgs";
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

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

type TwoHopItemRenderArgs = SectionedVirtualListItemRenderArgs<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

interface CachedItemRenderArgs {
	readonly observerRoot: HTMLElement | null;
	readonly args: TwoHopItemRenderArgs;
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
	const itemRenderArgsCache = new WeakMap<
		TwoHopMountedItemCell,
		CachedItemRenderArgs
	>();

	const createItemRenderArgs = (
		renderedCell: TwoHopMountedItemCell,
		observerRoot: HTMLElement | null,
	): TwoHopItemRenderArgs => {
		const cached = itemRenderArgsCache.get(renderedCell);
		if (cached?.observerRoot === observerRoot) {
			return cached.args;
		}

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
		const args: TwoHopItemRenderArgs = {
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
		itemRenderArgsCache.set(renderedCell, { observerRoot, args });
		return args;
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
