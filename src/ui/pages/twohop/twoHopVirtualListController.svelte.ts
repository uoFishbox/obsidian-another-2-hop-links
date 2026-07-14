import { IS_PROD } from "../../../appConstants";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { MountedFlatCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type { ProgrammaticScrollSnapshot } from "ui/components/common/virtual-list/dom/flushVirtualScrollMeasurement";
import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { VirtualizedItemResolvedVisibilityState } from "ui/components/common/virtual-list/svelte/virtualizedItemVisibilityState.svelte";
import type { TwoHopFixedRowSlotController } from "./twoHopFixedRowSlotPool.svelte";
import {
	createTwoHopMeasurementBridge,
	createTwoHopMeasurementState,
} from "./twoHopMeasurementBridge.svelte";
import { createTwoHopMountedSurfaceRuntime } from "./twoHopMountedSurfaceRuntime.svelte";
import type { TwoHopMountedCell, TwoHopMountedRowSlice } from "./twoHopMountedTypes";
import {
	createTwoHopVirtualListPlanRuntime,
	type TwoHopVirtualListSurfaceProps,
} from "./twoHopVirtualListPlanRuntime.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";

export type { TwoHopVirtualListSurfaceProps };

/** Stable public boundary consumed by the two-hop Svelte surface. */
export interface TwoHopVirtualListController {
	rootEl: HTMLDivElement | null;
	readonly observerRoot: HTMLElement | null;
	readonly contentHeight: number;
	readonly layout: ViewPlanLayoutMetrics;
	readonly mountedRows: readonly TwoHopMountedRowSlice[];
	readonly rowSlotControllers: readonly TwoHopFixedRowSlotController[];
	readonly getCellDataTestId:
		| ((
				cell: MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
		  ) => string | undefined)
		| undefined;
	readonly getItemVisibilityState: (
		cell: TwoHopMountedCell,
	) => VirtualizedItemResolvedVisibilityState;
	readonly getItemActivationCandidateId: (
		cell: Extract<TwoHopMountedCell, { cell: { kind: "item" } }>,
	) => string;
	loadMore(sectionId: string): void;
	resolveNavigationTarget(
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): ReturnType<
		ReturnType<typeof createTwoHopVirtualListPlanRuntime>["resolveNavigationTarget"]
	>;
	flushScrollMeasurement(snapshot: ProgrammaticScrollSnapshot): void;
}

/** Composes plan, measurement, and mounted-surface runtimes behind one facade. */
export function createTwoHopVirtualListController(
	props: TwoHopVirtualListSurfaceProps,
): TwoHopVirtualListController {
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
	const { measurementRuntime } = createTwoHopMeasurementBridge({
		inputRuntime,
		surfaceRuntime,
		measurementState,
	});

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
		get rowSlotControllers() {
			return surfaceRuntime.fixedRowSlotControllers;
		},
		getCellDataTestId: !IS_PROD
			? (cell) =>
					cell.cell.kind === "header"
						? `section-block-${cell.sectionId}`
						: undefined
			: undefined,
		getItemVisibilityState: surfaceRuntime.getItemVisibilityState,
		getItemActivationCandidateId: surfaceRuntime.getItemActivationCandidateId,
		loadMore: inputRuntime.loadMore,
		resolveNavigationTarget: inputRuntime.resolveNavigationTarget,
		flushScrollMeasurement: measurementRuntime.flushVirtualScrollMeasurement,
	};
}
