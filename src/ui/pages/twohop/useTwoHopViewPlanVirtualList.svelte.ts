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
import { type TwoHopViewPlanRowModel } from "./twoHopViewPlan";
import {
	rangeOverlap,
	type RowRange,
} from "ui/components/common/virtual-list/rowRange";
import type {
	TwoHopPageVirtualSection,
	TwoHopPageVirtualItem,
	TwoHopSectionDescriptor,
} from "./twohopPageVirtualModel";
import { createTwoHopLayoutPlanCache } from "./twoHopLayoutPlanCache";
import { createTwoHopMountRuntime } from "./twoHopMountRuntime.svelte";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";

const EMPTY_MOUNTED_CELLS: readonly [] = [];
const EMPTY_MOUNTED_ROWS: readonly [] = [];

/**
 * Whether a background materialization step needs a synchronous mounted-rows
 * recompute. When the snapshot has no mounted range yet we default to
 * recompute so the initial mounted build reflects the freshly materialized
 * cells; once a range exists we only recompute when it actually overlaps the
 * affected rows.
 */
function affectsMountedRows(
	mounted: RowRange | undefined,
	affectedRowRange: RowRange | null,
): boolean {
	if (affectedRowRange === null) return false;
	if (mounted === undefined) return true;
	const overlap = rangeOverlap(mounted, affectedRowRange);
	return overlap.start < overlap.end;
}

const INITIAL_MATERIALIZATION_SECTION_LIMIT = 8;
const INITIAL_MATERIALIZATION_CELL_LIMIT = 60;
const BACKGROUND_MATERIALIZATION_CELL_LIMIT = 100;

export interface TwoHopViewPlanVirtualListProps {
	readonly sections: readonly TwoHopSectionDescriptor[];
	readonly applicationStore?: ApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
}

export function useTwoHopViewPlanVirtualList(props: TwoHopViewPlanVirtualListProps) {
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
			initial: {
				maxSectionCount: INITIAL_MATERIALIZATION_SECTION_LIMIT,
				maxCellCount: INITIAL_MATERIALIZATION_CELL_LIMIT,
			},
			background: {
				maxCellCountPerSlice: BACKGROUND_MATERIALIZATION_CELL_LIMIT,
			},
		},
		getWindow: () => measurementState.rootEl?.ownerDocument.defaultView ?? null,
		resolveInitialSectionVisibleCount: inputState.resolveInitialSectionVisibleCount,
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
	const rowPreviewActivationRuntime = getContext<
		RowPreviewActivationRuntime | undefined
	>(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY);
	const mountRuntime = createTwoHopMountRuntime({
		rowPreviewActivationRuntime,
	});
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
	const mountedBuild = $derived(virtualList.getReconciliationState().mountedBuild);
	const contentHeight = $derived(virtualList.getTotalHeight(rowModel.totalHeight));

	$effect(() => {
		inputState.syncVisibleCountsForInput();
	});
	$effect(() => {
		measurementRuntime.scheduleLayoutMeasurementForCardLayout(configuredCardLayout);
	});
	$effect(() => {
		void inputState.validatedSections;
		void inputState.sectionVisibleCounts;
		measurementRuntime.updateCachedMeasurementForDataChange();
	});
	$effect(() => {
		const activeRowModel = rowModel;
		return layoutPlanCache.scheduleMaterialization(
			activeRowModel,
			(affectedRowRange) => {
				// Background materialization mostly builds cells for rows that are not
				// currently mounted. Skip the synchronous recompute when the affected
				// row range falls entirely outside the mounted range: the next scroll /
				// mounted-range recompute will pick up the freshly materialized cells.
				if (
					!affectsMountedRows(
						virtualList.getSnapshot()?.ranges.mounted,
						affectedRowRange,
					)
				) {
					return;
				}
				virtualList.recompute({ rowModel: activeRowModel });
			},
		);
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
		flushVirtualScrollMeasurement: measurementRuntime.flushVirtualScrollMeasurement,
	};
}
