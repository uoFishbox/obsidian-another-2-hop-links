import { IS_PROD } from "../../../appConstants";
import type { MountedFlatCell } from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
import {
	createTwoHopMeasurementBridge,
	createTwoHopMeasurementState,
} from "./twoHopMeasurementBridge.svelte";
import { createTwoHopMountedSurfaceRuntime } from "./twoHopMountedSurfaceRuntime.svelte";
import {
	createTwoHopVirtualListRuntime,
	type TwoHopViewPlanVirtualListProps,
} from "./twoHopVirtualListRuntime.svelte";
import type {
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection,
} from "./twohopPageVirtualModel";
import { affectsMountedRows } from "./twoHopMaterializationRecomputePolicy";

export type { TwoHopViewPlanVirtualListProps };

export function useTwoHopViewPlanVirtualList(props: TwoHopViewPlanVirtualListProps) {
	const measurementState = createTwoHopMeasurementState();
	const inputRuntime = createTwoHopVirtualListRuntime({
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
		get mountedRowsVersion() {
			return surfaceRuntime.mountedRowsVersion;
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
		createItemRenderArgs: surfaceRuntime.createItemRenderArgs,
		loadMore: inputRuntime.loadMore,
		resolveNavigationTarget: inputRuntime.resolveNavigationTarget,
		flushVirtualScrollMeasurement: measurementRuntime.flushVirtualScrollMeasurement,
	};
}
