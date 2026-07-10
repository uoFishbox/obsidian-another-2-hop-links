import { getContext } from "svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import { createViewPlanInputState } from "ui/components/common/virtual-list/svelte/viewPlanInputState.svelte";
import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import { resolveCardLayoutSettings } from "ui/utils/cardLayoutCssVars";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
	TwoHopVirtualSectionDescriptor,
} from "./twoHopVirtualListModel";
import { createTwoHopRowModelCache } from "./twoHopRowModelCache";
import { type TwoHopViewPlanRowModel } from "./twoHopViewPlan";

type ViewPlanMeasurementState = ReturnType<
	typeof import("ui/components/common/virtual-list/svelte/viewPlanMeasurement.svelte").createViewPlanMeasurementState
>;

export interface TwoHopVirtualListSurfaceProps {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly applicationStore?: ApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
}

export function createTwoHopVirtualListPlanRuntime(params: {
	readonly props: TwoHopVirtualListSurfaceProps;
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
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>({
		getSections: () => params.props.sections,
		applicationStore,
		initialVisibleCount: params.props.initialVisibleCount,
		loadMoreIncrement: params.props.loadMoreIncrement,
	});
	const layoutPlanCache = createTwoHopRowModelCache({
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

export type TwoHopVirtualListPlanRuntime = ReturnType<
	typeof createTwoHopVirtualListPlanRuntime
>;
