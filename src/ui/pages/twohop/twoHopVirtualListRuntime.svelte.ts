import { getContext } from "svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import { createViewPlanInputState } from "ui/components/common/virtual-list/svelte/viewPlanInputState.svelte";
import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import { resolveCardLayoutSettings } from "ui/utils/cardLayoutCssVars";
import type {
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection,
	TwoHopSectionDescriptor,
} from "./twohopPageVirtualModel";
import { createTwoHopLayoutPlanCache } from "./twoHopLayoutPlanCache";
import { type TwoHopViewPlanRowModel } from "./twoHopViewPlan";
import {
	DEFAULT_TWO_HOP_VIRTUAL_LIST_TUNING,
	resolveMaterializationFromTuning,
	type TwoHopVirtualListTuning,
} from "./twoHopVirtualListTuning";

type ViewPlanMeasurementState = ReturnType<
	typeof import("ui/components/common/virtual-list/svelte/viewPlanMeasurement.svelte").createViewPlanMeasurementState
>;

export interface TwoHopViewPlanVirtualListProps {
	readonly sections: readonly TwoHopSectionDescriptor[];
	readonly applicationStore?: ApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly tuning?: TwoHopVirtualListTuning;
}

export function createTwoHopVirtualListRuntime(params: {
	readonly props: TwoHopViewPlanVirtualListProps;
	readonly measurementState: ViewPlanMeasurementState;
}) {
	let applicationStore = params.props.applicationStore;
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
		getSections: () => params.props.sections,
		applicationStore,
		initialVisibleCount: params.props.initialVisibleCount,
		loadMoreIncrement: params.props.loadMoreIncrement,
	});
	const layoutPlanCache = createTwoHopLayoutPlanCache({
		materialization: resolveMaterializationFromTuning(
			params.props.tuning ?? DEFAULT_TWO_HOP_VIRTUAL_LIST_TUNING,
		),
		getWindow: () =>
			params.measurementState.rootEl?.ownerDocument.defaultView ?? null,
		resolveInitialSectionVisibleCount: inputState.resolveInitialSectionVisibleCount,
		clampVisibleCount: inputState.clampVisibleCount,
	});
	const resolveRowModel = (
		layout: ViewPlanLayoutMetrics = params.measurementState.layout,
	): TwoHopViewPlanRowModel =>
		layoutPlanCache.resolve(
			inputState.validatedSections,
			inputState.sectionVisibleCounts,
			layout,
		);
	const rowModel = $derived(resolveRowModel());

	return {
		applicationStore,
		inputState,
		layoutPlanCache,
		get configuredCardLayout() {
			return configuredCardLayout;
		},
		get validatedSections() {
			return inputState.validatedSections;
		},
		get sectionVisibleCounts() {
			return inputState.sectionVisibleCounts;
		},
		get rowModel() {
			return rowModel;
		},
		resolveRowModel,
		loadMore: inputState.loadMore,
		resolveNavigationTarget(
			currentKey: string,
			direction: import("features/keyboard-navigation/resultFocus").ResultNavigationDirection,
			currentPosition: { rowIndex: number; columnIndex: number },
		) {
			return (
				rowModel.resolveNavigationTarget?.(
					currentKey,
					direction,
					currentPosition,
				) ?? null
			);
		},
	};
}

export type TwoHopVirtualListRuntime = ReturnType<
	typeof createTwoHopVirtualListRuntime
>;
