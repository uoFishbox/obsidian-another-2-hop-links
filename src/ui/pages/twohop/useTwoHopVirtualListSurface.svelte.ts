import { IS_PROD } from "../../../appConstants";
import type { MountedFlatCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import {
	createTwoHopMeasurementBridge,
	createTwoHopMeasurementState,
} from "./twoHopMeasurementBridge.svelte";
import { createTwoHopMountedSurfaceRuntime } from "./twoHopMountedSurfaceRuntime.svelte";
import {
	createTwoHopVirtualListPlanRuntime,
	type TwoHopVirtualListSurfaceProps,
} from "./twoHopVirtualListPlanRuntime.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import { affectsMountedRows } from "./twoHopMaterializationRecomputePolicy";

export type { TwoHopVirtualListSurfaceProps as TwoHopViewPlanVirtualListProps };

export function useTwoHopViewPlanVirtualList(props: TwoHopVirtualListSurfaceProps) {
	const measurementState = createTwoHopMeasurementState();
	const inputRuntime = createTwoHopVirtualListPlanRuntime({
		props,
		measurementState,
	});
	const surfaceRuntime = createTwoHopMountedSurfaceRuntime({
		inputRuntime,
		onStableVisibleRange: () => {
			measurementState.measurement.hasStableVisibleRange = true;
		},
	});
	const measurementBridge = createTwoHopMeasurementBridge({
		inputRuntime,
		surfaceRuntime,
		measurementState,
	});
	const { measurementRuntime } = measurementBridge;

	$effect(() => {
		inputRuntime.inputState.syncVisibleCountsForInput();
	});
	$effect(() => {
		measurementRuntime.scheduleLayoutMeasurementForCardLayout(
			inputRuntime.configuredCardLayout,
		);
	});
	$effect(() => {
		void inputRuntime.validatedSections;
		void inputRuntime.sectionVisibleCounts;
		measurementRuntime.updateCachedMeasurementForDataChange();
	});
	$effect(() => {
		const activeRowModel = inputRuntime.rowModel;
		return inputRuntime.materializationScheduler.schedule(
			activeRowModel,
			(affectedRowRange) => {
				// Background materialization mostly builds cells for rows that are not
				// currently mounted. Skip the synchronous recompute when the affected
				// row range falls entirely outside the mounted range: the next scroll /
				// mounted-range recompute will pick up the freshly materialized cells.
				if (
					!affectsMountedRows(
						surfaceRuntime.virtualList.getSnapshot()?.ranges.mounted,
						affectedRowRange,
					)
				) {
					return;
				}
				surfaceRuntime.virtualList.recompute({ rowModel: activeRowModel });
			},
		);
	});
	$effect(() => measurementRuntime.observeRootElement());

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
			return surfaceRuntime.contentHeight;
		},
		get layout() {
			return measurementState.layout;
		},
		get mountedRows() {
			return surfaceRuntime.mountedRowsForSurface;
		},
		get mountedRowSlots() {
			return surfaceRuntime.mountedRowSlotsForSurface;
		},
		getCellDataTestId: !IS_PROD
			? (
					cell: MountedFlatCell<
						TwoHopVirtualListItem,
						TwoHopVirtualListSection
					>,
				) =>
					cell.cell.kind === "header"
						? `section-block-${cell.sectionId}`
						: undefined
			: undefined,
		getItemVisibilityState: surfaceRuntime.getItemVisibilityState,
		getItemActivationCandidateId: surfaceRuntime.getItemActivationCandidateId,
		loadMore: inputRuntime.loadMore,
		resolveNavigationTarget: inputRuntime.resolveNavigationTarget,
		flushVirtualScrollMeasurement: measurementRuntime.flushVirtualScrollMeasurement,
	};
}
