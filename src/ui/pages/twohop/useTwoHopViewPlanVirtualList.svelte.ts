import { getContext, untrack } from "svelte";
import { IS_PROD } from "../../../appConstants";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type {
	MountedFlatCell,
	MountedFlatItemCell,
} from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
import { resolveCardLayoutSettings } from "ui/utils/cardLayoutCssVars";
import { createViewPlanInputState } from "ui/components/common/virtual-list/svelte/viewPlanInputState.svelte";
import {
	createViewPlanMeasurementRuntime,
	createViewPlanMeasurementState,
} from "ui/components/common/virtual-list/svelte/viewPlanMeasurement.svelte";
import { createViewPlanCardVirtualListPolicyResolver } from "ui/components/common/virtual-list/svelte/viewPlanPolicy";
import { useVirtualList } from "ui/components/common/virtual-list/svelte/useVirtualList.svelte";
import { resolveVirtualizedItemVisibilityForPreviewRange } from "ui/components/common/virtual-list/svelte/virtualizedItemVisibilityState.svelte";
import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";
import type { VirtualizedItemVisibility } from "ui/components/common/virtual-list/types";
import type { TwoHopMountedRowsBuild } from "./twoHopMountedRowBuild";
import {
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";
import type {
	TwoHopPageVirtualSection,
	TwoHopPageVirtualItem,
	TwoHopSectionDescriptor,
} from "./twohopPageVirtualModel";
import { createTwoHopLayoutPlanCache } from "./twoHopLayoutPlanCache";
import { createTwoHopMountRuntime } from "./twoHopMountRuntime.svelte";

const EMPTY_MOUNTED_CELLS: readonly [] = [];
const EMPTY_MOUNTED_ROWS: readonly [] = [];
const MATERIALIZATION_BATCH_SIZE = 10;
const MATERIALIZATION_BATCH_CELL_LIMIT = 200;

export interface TwoHopViewPlanVirtualListProps {
	readonly sections: readonly TwoHopSectionDescriptor[];
	readonly applicationStore?: ApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
}

export function useTwoHopViewPlanVirtualList(
	props: TwoHopViewPlanVirtualListProps,
) {
	let applicationStore = props.applicationStore;
	if (!applicationStore) {
		applicationStore = getContext<ApplicationStore>("applicationStore");
	}
	const configuredCardLayout = $derived.by(() =>
		applicationStore?.settings
			? resolveCardLayoutSettings(applicationStore.settings)
			: null,
	);
	const inputState = createViewPlanInputState<
		TwoHopPageVirtualItem,
		TwoHopPageVirtualSection
	>({
		getSections: () => props.sections,
		applicationStore,
		initialVisibleCount: props.initialVisibleCount,
		loadMoreIncrement: props.loadMoreIncrement,
	});
	const measurementState = createViewPlanMeasurementState();
	const layoutPlanCache = createTwoHopLayoutPlanCache({
		materialization: {
			kind: "batched",
			initialSectionCount: MATERIALIZATION_BATCH_SIZE,
			initialCellCount: MATERIALIZATION_BATCH_CELL_LIMIT,
		},
		getWindow: () => measurementState.rootEl?.ownerDocument.defaultView ?? null,
		resolveInitialSectionVisibleCount:
			inputState.resolveInitialSectionVisibleCount,
		clampVisibleCount: inputState.clampVisibleCount,
	});
	const resolveRowModel = (
		layout = measurementState.layout,
	): TwoHopViewPlanRowModel =>
		layoutPlanCache.resolve(
			inputState.validatedSections,
			inputState.sectionVisibleCounts,
			layout,
		);
	const rowModel = $derived(resolveRowModel());
	const mountRuntime = createTwoHopMountRuntime();
	const virtualList = useVirtualList<
		import("ui/components/common/virtual-list/logicalCell").VirtualListLogicalCell<TwoHopPageVirtualItem>,
		TwoHopViewPlanRowModel,
		MountedFlatCell<TwoHopPageVirtualItem, TwoHopPageVirtualSection>,
		TwoHopMountedRowsBuild
	>({
		buildMountedCells: (params) => mountRuntime.buildMountedRows(params),
		visibilityMetadataPolicy: { type: "caller-managed" },
		trackMountedCellsForChange: false,
		onStableVisibleRange: () => {
			measurementState.measurement.hasStableVisibleRange = true;
		},
		onSnapshotUpdated: (snapshot, reconciliationState) => {
			mountRuntime.syncSnapshot(
				reconciliationState.mountedBuild,
				snapshot.ranges.previewVisible,
			);
		},
	});
	const runtime = {
		get validatedSections() {
			return inputState.validatedSections;
		},
		get sectionVisibleCounts() {
			return inputState.sectionVisibleCounts;
		},
		get rowModel() {
			return rowModel;
		},
		get virtualList() {
			return virtualList;
		},
		resolveRowModel,
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
	const policyResolver = createViewPlanCardVirtualListPolicyResolver({
		getPreviewActivationAheadRows: () =>
			applicationStore?.settings?.previewActivationAheadRows ?? 1,
	});
	const measurementRuntime = createViewPlanMeasurementRuntime({
		state: measurementState,
		runtime,
		getConfiguredCardLayout: () => configuredCardLayout,
		getValidatedSections: () => inputState.validatedSections,
		policyResolver,
	});
	const mountedBuild = $derived(
		virtualList.getReconciliationState().mountedBuild,
	);
	const contentHeight = $derived(
		virtualList.getTotalHeight(rowModel.totalHeight),
	);

	$effect(() => {
		inputState.syncVisibleCountsForInput();
	});
	$effect(() => {
		measurementRuntime.scheduleLayoutMeasurementForCardLayout(
			configuredCardLayout,
		);
	});
	$effect(() => {
		void inputState.validatedSections;
		void inputState.sectionVisibleCounts;
		measurementRuntime.updateCachedMeasurementForDataChange();
	});
	$effect(() => {
		const activeRowModel = rowModel;
		return layoutPlanCache.scheduleMaterialization(activeRowModel, () => {
			virtualList.recompute({ rowModel: activeRowModel });
		});
	});
	$effect(() => measurementRuntime.observeRootElement());

	const createItemRenderArgs = (
		renderedCell: MountedFlatItemCell<
			TwoHopPageVirtualItem,
			TwoHopPageVirtualSection
		>,
		observerRoot: HTMLElement | null,
	): {
		item: TwoHopPageVirtualItem;
		section: TwoHopPageVirtualSection;
		index: number;
		observerRoot: HTMLElement | null;
		visibilityState: VirtualizedItemVisibilityState;
		readonly visibility: VirtualizedItemVisibility;
	} => {
		const visibilityState = mountRuntime.getOrCreateVisibilityState(
			renderedCell,
			untrack(() => {
				const previewVisible =
					virtualList.getSnapshot()?.ranges.previewVisible;
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
			observerRoot,
			visibilityState,
			get visibility() {
				return visibilityState.visibility;
			},
		};
	};

	return {
		get rootEl() {
			return measurementState.rootEl;
		},
		set rootEl(rootEl: HTMLDivElement | null) {
			measurementState.rootEl = rootEl;
		},
		get observerRoot() {
			return measurementState.measurement.scrollContainerEl;
		},
		get contentHeight() {
			return contentHeight;
		},
		get layout() {
			return measurementState.layout;
		},
		get mountedCellsForSurface() {
			return EMPTY_MOUNTED_CELLS;
		},
		get mountedRows() {
			return mountedBuild?.rowSlices ?? EMPTY_MOUNTED_ROWS;
		},
		getCellDataTestId: !IS_PROD
			? (
					cell: MountedFlatCell<
						TwoHopPageVirtualItem,
						TwoHopPageVirtualSection
					>,
				) =>
					cell.cell.kind === "header"
						? `section-block-${cell.sectionId}`
						: undefined
			: undefined,
		createItemRenderArgs,
		loadMore: inputState.loadMore,
		resolveNavigationTarget: (
			currentKey: string,
			direction: import("features/keyboard-navigation/resultFocus").ResultNavigationDirection,
			currentPosition: { rowIndex: number; columnIndex: number },
		) =>
			rowModel.resolveNavigationTarget?.(
				currentKey,
				direction,
				currentPosition,
			) ?? null,
		flushVirtualScrollMeasurement:
			measurementRuntime.flushVirtualScrollMeasurement,
	};
}
