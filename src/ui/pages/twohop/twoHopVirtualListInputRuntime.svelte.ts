import { getContext } from "svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import { createViewPlanInputState } from "ui/components/common/virtual-list/svelte/viewPlanInputState.svelte";
import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import { createResolvedCardLayoutSettingsMemo } from "ui/utils/cardLayoutCssVars";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
	TwoHopVirtualSectionDescriptor,
} from "./twoHopVirtualListModel";
import { createTwoHopCompiledPlanCache } from "./twoHopCompiledPlanCache";
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

/** Resolves input, pagination, layout settings, and the compiled plan. */
export function createTwoHopVirtualListInputRuntime(params: {
	readonly props: TwoHopVirtualListSurfaceProps;
	readonly measurementState: ViewPlanMeasurementState;
}) {
	let applicationStore = params.props.applicationStore;
	if (!applicationStore) {
		applicationStore = getContext<ApplicationStore>("applicationStore");
	}
	const resolveConfiguredCardLayout = createResolvedCardLayoutSettingsMemo();
	const configuredCardLayout = $derived.by(() =>
		resolveConfiguredCardLayout(applicationStore?.settings),
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
	const compiledPlanCache = createTwoHopCompiledPlanCache({
		resolveInitialSectionVisibleCount: inputState.resolveInitialSectionVisibleCount,
		clampVisibleCount: inputState.clampVisibleCount,
	});
	const resolveRowModel = (
		layout: ViewPlanLayoutMetrics = params.measurementState.layout,
	): TwoHopViewPlanRowModel =>
		compiledPlanCache.resolve(
			inputState.validatedSections,
			inputState.sectionVisibleCounts,
			layout,
		);
	const rowModel = $derived(resolveRowModel());

	return {
		applicationStore,
		inputState,
		compiledPlanCache,
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

export type TwoHopVirtualListInputRuntime = ReturnType<
	typeof createTwoHopVirtualListInputRuntime
>;
