import { getContext } from "svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createTwoHopDocumentProjection,
	type TwoHopDocument,
} from "features/two-hop/ui/twoHopDocument";
import {
	createTwoHopVirtualRowModel,
	type TwoHopLogicalCell,
	type TwoHopVirtualRowModel,
} from "features/two-hop/ui/twoHopVirtualRowModel";
import {
	buildTwoHopMountedRows,
	type TwoHopMountedCell,
	type TwoHopMountedRowsBuild,
} from "features/two-hop/ui/twoHopMountedRows";
import { createResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import { useVirtualList } from "ui/virtualization/svelte/useVirtualList.svelte";
import {
	createViewPlanMeasurementRuntime,
	createViewPlanMeasurementState,
} from "ui/virtualization/svelte/viewPlanMeasurement.svelte";
import { createViewPlanCardVirtualListPolicyResolver } from "ui/virtualization/svelte/viewPlanPolicy";
import type { ViewPlanLayoutMetrics } from "ui/virtualization/svelte/viewPlanLayout";
import { createResolvedCardLayoutSettingsMemo } from "ui/shared/layout/cardLayoutCssVars";
import { createVirtualizedItemVisibilityStateController } from "ui/virtualization/svelte/virtualizedItemVisibilityState.svelte";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualNavigationTarget } from "ui/virtualization/types";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";

export interface TwoHopVirtualListProps {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly applicationStore?: ApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly previewActive?: boolean;
}

const EMPTY_RANGE: RowRange = { start: 0, end: 0 };
const EMPTY_MOUNTED_ROWS: readonly [] = [];

/** Connects TwoHop geometry to the shared pooled-row virtual surface. */
export function useTwoHopVirtualList(props: TwoHopVirtualListProps) {
	let applicationStore = props.applicationStore;
	if (!applicationStore) {
		try {
			applicationStore = getContext<ApplicationStore>("applicationStore");
		} catch {
			applicationStore = undefined;
		}
	}

	const previewRuntime = getContext<RowPreviewActivationRuntime | undefined>(
		PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	);
	const visibilityStates =
		createVirtualizedItemVisibilityStateController<TwoHopMountedCell>({
			onVisibilityDelta: (delta) => previewRuntime?.applyVisibilityDelta(delta),
		});
	const documentProjection = createTwoHopDocumentProjection({
		sections: props.sections,
		applicationStore,
		initialVisibleCount: props.initialVisibleCount,
		loadMoreIncrement: props.loadMoreIncrement,
	});
	let document = $state.raw<TwoHopDocument>(documentProjection.getDocument());
	const measurementState = createViewPlanMeasurementState();
	const rowSlotAllocator = createResidentRowSlotAllocator();
	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore?.settings),
	);

	let cachedDocument: TwoHopDocument | undefined;
	let cachedLayout: ViewPlanLayoutMetrics | undefined;
	let cachedRowModel: TwoHopVirtualRowModel | undefined;
	const resolveRowModel = (
		layout: ViewPlanLayoutMetrics = measurementState.layout,
	): TwoHopVirtualRowModel => {
		if (cachedRowModel && cachedDocument === document && cachedLayout === layout) {
			return cachedRowModel;
		}
		cachedDocument = document;
		cachedLayout = layout;
		cachedRowModel = createTwoHopVirtualRowModel(document, layout);
		return cachedRowModel;
	};
	const rowModel = $derived(resolveRowModel());

	const syncDisplaySnapshot = (params: {
		readonly rowModel: object;
		readonly mountedRange: RowRange;
		readonly previewRange: RowRange;
		readonly build: TwoHopMountedRowsBuild | null;
	}): void => {
		visibilityStates.commit({
			rowModelRevision: params.rowModel,
			mountedRows: params.build?.rowSlices ?? EMPTY_MOUNTED_ROWS,
			mountedRange: params.mountedRange,
			previewActiveRange:
				props.previewActive === false ? EMPTY_RANGE : params.previewRange,
		});
	};

	const virtualList = useVirtualList<
		TwoHopLogicalCell,
		TwoHopVirtualRowModel,
		TwoHopMountedCell,
		TwoHopMountedRowsBuild
	>({
		buildMountedCells: ({ rowModel: activeRowModel, rowRange, previousBuild }) =>
			buildTwoHopMountedRows({
				rowModel: activeRowModel,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			}),
		mountedRowsReconciler: rowSlotAllocator,
		visibilityMetadataPolicy: { type: "caller-managed" },
		providePreviousCellsByKey: false,
		trackMountedCellsForChange: false,
		onStableVisibleRange: () => {
			measurementState.measurement.hasStableVisibleRange = true;
		},
		onSnapshotUpdated: (snapshot, reconciliationState) => {
			syncDisplaySnapshot({
				rowModel: snapshot.rowModel,
				mountedRange: snapshot.ranges.mounted,
				previewRange: snapshot.ranges.previewVisible,
				build: reconciliationState.mountedBuild,
			});
		},
	});

	const policyResolver = createViewPlanCardVirtualListPolicyResolver({
		getPreviewActivationAheadRows: () =>
			applicationStore?.settings?.previewActivationAheadRows ?? 1,
	});
	const initialRowModel = resolveRowModel(measurementState.layout);
	if (initialRowModel.rowCount > 0) {
		virtualList.applyMeasurement({
			rowModel: initialRowModel,
			scrollTop: 0,
			viewportHeight: measurementState.layout.rowHeight * 3,
			sectionTop: 0,
			isStableMeasurement: false,
			isScrollActive: false,
			hasStableVisibleRange: false,
			visibilityPolicy: policyResolver.resolve(measurementState.layout, false),
		});
	}
	const measurementRuntime = createViewPlanMeasurementRuntime({
		state: measurementState,
		runtime: {
			get rowModel() {
				return rowModel;
			},
			virtualList,
			resolveRowModel,
			syncPreviewVisibleRange(start, end) {
				const snapshot = virtualList.getSnapshot();
				if (!snapshot) return;
				syncDisplaySnapshot({
					rowModel: snapshot.rowModel,
					mountedRange: snapshot.ranges.mounted,
					previewRange: { start, end },
					build: virtualList.getReconciliationState().mountedBuild,
				});
			},
			cancelPreviewVisibleRangeSync() {
				const snapshot = virtualList.getSnapshot();
				if (!snapshot) return;
				syncDisplaySnapshot({
					rowModel: snapshot.rowModel,
					mountedRange: snapshot.ranges.mounted,
					previewRange: EMPTY_RANGE,
					build: virtualList.getReconciliationState().mountedBuild,
				});
			},
		},
		getConfiguredCardLayout: () => configuredLayout,
		getValidatedSections: () => props.sections,
		policyResolver,
	});

	const publishDocument = (nextDocument: TwoHopDocument): void => {
		if (nextDocument === document) return;
		document = nextDocument;
		const nextRowModel = resolveRowModel(measurementState.layout);
		const snapshot = virtualList.getSnapshot();
		if (nextRowModel.rowCount === 0) {
			virtualList.setEmpty({
				rowModel: nextRowModel,
				reason: "no-renderable-content",
			});
		} else if (snapshot) {
			virtualList.recompute({ rowModel: nextRowModel });
		}
		measurementRuntime.updateCachedMeasurementForDataChange();
	};

	$effect(() => {
		publishDocument(documentProjection.setSections(props.sections));
	});

	$effect(() => {
		measurementRuntime.scheduleLayoutMeasurementForCardLayout(configuredLayout);
	});

	$effect(() => measurementRuntime.observeRootElement());

	$effect(() => {
		const active = props.previewActive !== false;
		const snapshot = virtualList.getSnapshot();
		if (!snapshot) return;
		void active;
		syncDisplaySnapshot({
			rowModel: snapshot.rowModel,
			mountedRange: snapshot.ranges.mounted,
			previewRange: snapshot.ranges.previewVisible,
			build: virtualList.getReconciliationState().mountedBuild,
		});
	});

	const loadMore = (sectionId: string): void => {
		const nextDocument = documentProjection.loadMore(sectionId);
		if (nextDocument) publishDocument(nextDocument);
	};

	const resolveNavigationTarget = (
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualNavigationTarget | null =>
		rowModel.resolveNavigationTarget?.(currentKey, direction, currentPosition) ??
		null;

	return {
		get rootEl() {
			return measurementState.rootEl;
		},
		set rootEl(nextRootEl: HTMLDivElement | null) {
			measurementState.rootEl = nextRootEl;
		},
		get observerRoot() {
			return measurementState.measurement.scrollContainerEl;
		},
		get contentHeight() {
			return virtualList.getTotalHeight(rowModel.totalHeight);
		},
		get layout() {
			return measurementState.layout;
		},
		get mountedRows() {
			return (
				virtualList.getReconciliationState().mountedBuild?.rowsBySlot ??
				EMPTY_MOUNTED_ROWS
			);
		},
		getCellClassName(cell: TwoHopMountedCell): string | undefined {
			return cell.section.header.section.className;
		},
		getCellDataTestId(cell: TwoHopMountedCell): string | undefined {
			switch (cell.cell.kind) {
				case "header":
					return `section-block-${cell.section.key}`;
				case "item":
					return "twohop-item-cell";
				case "load-more":
					return `load-more-${cell.section.key}`;
			}
		},
		loadMore,
		resolveNavigationTarget,
		flushVirtualScrollMeasurement: measurementRuntime.flushVirtualScrollMeasurement,
	};
}
