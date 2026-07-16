import { IS_PROD } from "../../../appConstants";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { ProgrammaticScrollSnapshot } from "ui/components/common/virtual-list/dom/flushVirtualScrollMeasurement";
import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { VirtualizedItemResolvedVisibilityState } from "ui/components/common/virtual-list/svelte/virtualizedItemVisibilityState.svelte";
import type { VirtualNavigationTarget } from "ui/components/common/virtual-list/types";
import type { TwoHopFixedRowSlotController } from "./twoHopFixedRowSlotPool.svelte";
import {
	createTwoHopVirtualListInputRuntime,
	type TwoHopVirtualListSurfaceProps,
} from "./twoHopVirtualListInputRuntime.svelte";
import {
	createTwoHopMeasurementState,
	createTwoHopVirtualListMeasurementRuntime,
} from "./twoHopVirtualListMeasurementRuntime.svelte";
import { createTwoHopVirtualListMountedRuntime } from "./twoHopVirtualListMountedRuntime.svelte";
import type { TwoHopMountedCell, TwoHopMountedRowSlice } from "./twoHopMountedTypes";
import type { TwoHopSlotIdCell } from "./twoHopSlotId";
import type { TwoHopRenderCellSnapshot } from "./twoHopCellBinding";

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
				cell: Pick<TwoHopRenderCellSnapshot, "cell" | "sectionId">,
		  ) => string | undefined)
		| undefined;
	readonly getItemVisibilityState: (
		cell: TwoHopSlotIdCell,
	) => VirtualizedItemResolvedVisibilityState;
	readonly getMountedCellByInteractionId: (
		interactionId: string,
	) => TwoHopMountedCell | undefined;
	readonly getItemActivationCandidateId: (cell: TwoHopSlotIdCell) => string;
	loadMore(sectionId: string): void;
	resolveNavigationTarget(
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualNavigationTarget | null;
	flushScrollMeasurement(snapshot: ProgrammaticScrollSnapshot): void;
}

/** Composes the one-way input -> plan -> measurement -> slot pipeline. */
export function createTwoHopVirtualListController(
	props: TwoHopVirtualListSurfaceProps,
): TwoHopVirtualListController {
	const measurementState = createTwoHopMeasurementState();
	const inputRuntime = createTwoHopVirtualListInputRuntime({
		props,
		measurementState,
	});
	const mountedRuntime = createTwoHopVirtualListMountedRuntime({
		inputRuntime,
		onStableVisibleRange: () => {
			measurementState.measurement.hasStableVisibleRange = true;
		},
	});
	const { measurementRuntime } = createTwoHopVirtualListMeasurementRuntime({
		inputRuntime,
		mountedRuntime,
		measurementState,
	});

	$effect(() => inputRuntime.inputState.syncVisibleCountsForInput());
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
			return mountedRuntime.contentHeight;
		},
		get layout() {
			return measurementState.layout;
		},
		get mountedRows() {
			return mountedRuntime.mountedRows;
		},
		get rowSlotControllers() {
			return mountedRuntime.rowSlotControllers;
		},
		getCellDataTestId: !IS_PROD
			? (cell) =>
					cell.cell.kind === "header"
						? `section-block-${cell.sectionId}`
						: undefined
			: undefined,
		getItemVisibilityState: mountedRuntime.getItemVisibilityState,
		getMountedCellByInteractionId: mountedRuntime.getMountedCellByInteractionId,
		getItemActivationCandidateId: mountedRuntime.getItemActivationCandidateId,
		loadMore: inputRuntime.loadMore,
		resolveNavigationTarget: inputRuntime.resolveNavigationTarget,
		flushScrollMeasurement: measurementRuntime.flushVirtualScrollMeasurement,
	};
}
