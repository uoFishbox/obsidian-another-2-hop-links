import { getContext, onDestroy } from "svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
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
import { createTwoHopResidentRowSlotAllocator } from "features/two-hop/ui/twoHopResidentRowSlotAllocator";
import { useVirtualList } from "ui/virtualization/svelte/useVirtualList.svelte";
import {
	createViewPlanMeasurementRuntime,
	createViewPlanMeasurementState,
} from "ui/virtualization/svelte/viewPlanMeasurement.svelte";
import { createViewPlanCardVirtualListPolicyResolver } from "ui/virtualization/svelte/viewPlanPolicy";
import {
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "ui/virtualization/svelte/viewPlanLayout";
import { createResolvedCardLayoutSettingsMemo } from "ui/shared/layout/cardLayoutCssVars";
import { createVirtualizedItemVisibilityStateController } from "ui/virtualization/svelte/virtualizedItemVisibilityState.svelte";
import type { PreviewBackpressure } from "features/preview/scheduling/previewActivationScheduler";
import {
	createRowPreviewController,
	type RowPreviewCardBinding,
} from "features/preview/scheduling/rowPreviewController.svelte";
import { resolveTwoHopItemStaticState } from "features/two-hop/ui/twoHopCellStaticState";
import {
	createVirtualCardInteractionController,
	type VirtualCardInteractionBinding,
} from "ui/interactions/virtualCardInteractionController";
import { useLinkContext } from "ui/context/linkContext";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualNavigationTarget } from "ui/virtualization/types";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

export interface TwoHopVirtualListProps {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly applicationStore?: ApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly previewActive?: boolean;
	readonly resolveItemCardModel?: (
		item: TwoHopVirtualListItem,
		presentation: TwoHopCardPresentationState,
	) => CardRenderModel;
}

const EMPTY_RANGE: RowRange = { start: 0, end: 0 };
const EMPTY_MOUNTED_ROWS: readonly [] = [];

/** Connects TwoHop geometry to the shared pooled-row virtual surface. */
export function useTwoHopVirtualList(
	props: TwoHopVirtualListProps,
	frameCoordinator?: VirtualFrameCoordinator,
) {
	let applicationStore = props.applicationStore;
	if (!applicationStore) {
		try {
			applicationStore = getContext<ApplicationStore>("applicationStore");
		} catch {
			applicationStore = undefined;
		}
	}

	let linkContext: ReturnType<typeof useLinkContext> | undefined;
	try {
		linkContext = useLinkContext();
	} catch {
		linkContext = undefined;
	}
	const previewController = createRowPreviewController({
		getBackpressure: (): PreviewBackpressure => ({
			queued: linkContext?.getVisiblePreviewQueueSize?.() ?? 0,
			active: linkContext?.getActiveVisiblePreviewCount?.() ?? 0,
		}),
		subscribeBackpressure: linkContext?.subscribeVisiblePreviewQueue,
		schedulerIdentity: linkContext?.previewSchedulingIdentity,
		frameCoordinator,
	});
	const interactionController = createVirtualCardInteractionController();
	const visibilityStates =
		createVirtualizedItemVisibilityStateController<TwoHopMountedCell>({});
	const documentProjection = createTwoHopDocumentProjection({
		sections: props.sections,
		applicationStore,
		initialVisibleCount: props.initialVisibleCount,
		loadMoreIncrement: props.loadMoreIncrement,
	});
	let document = $state.raw<TwoHopDocument>(documentProjection.getDocument());
	const measurementState = createViewPlanMeasurementState();
	const rowSlotAllocator = createTwoHopResidentRowSlotAllocator();
	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore?.settings),
	);

	let cachedDocument: TwoHopDocument | undefined;
	let cachedLayout: ViewPlanLayoutMetrics | undefined;
	let cachedRowModel: TwoHopVirtualRowModel | undefined;
	let residentSlotLayout: ViewPlanLayoutMetrics | undefined;
	let residentSlotLayoutKey: object = {};
	const resolveResidentSlotLayoutKey = (layout: ViewPlanLayoutMetrics): object => {
		if (residentSlotLayout && isSameViewPlanLayout(residentSlotLayout, layout)) {
			return residentSlotLayoutKey;
		}
		residentSlotLayout = { ...layout };
		residentSlotLayoutKey = {};
		return residentSlotLayoutKey;
	};
	const resolveRowModel = (
		layout: ViewPlanLayoutMetrics = measurementState.layout,
	): TwoHopVirtualRowModel => {
		if (cachedRowModel && cachedDocument === document && cachedLayout === layout) {
			return cachedRowModel;
		}
		cachedDocument = document;
		cachedLayout = layout;
		cachedRowModel = createTwoHopVirtualRowModel(
			document,
			layout,
			resolveResidentSlotLayoutKey(layout),
		);
		return cachedRowModel;
	};
	const rowModel = $derived(resolveRowModel());

	let hasSyncedCardBindings = false;
	let syncedCardBindingsBuild: TwoHopMountedRowsBuild | null = null;
	let syncedCardBindingsResolver = props.resolveItemCardModel;
	const previewCardBindings: RowPreviewCardBinding[] = [];
	const interactionCardBindings: VirtualCardInteractionBinding[] = [];

	const resolveMountedCardModel = (
		cell: TwoHopMountedCell,
		resolver: TwoHopVirtualListProps["resolveItemCardModel"],
	) => {
		if (cell.cell.kind !== "item" || !resolver) return undefined;
		const presentation = resolveTwoHopItemStaticState(
			cell.cell.item,
			cell.section.header.section,
		).presentation;
		if (!presentation) return undefined;
		return resolver(cell.cell.item, presentation);
	};

	const refreshCardBindings = (build: TwoHopMountedRowsBuild | null): boolean => {
		const resolver = props.resolveItemCardModel;
		if (
			hasSyncedCardBindings &&
			syncedCardBindingsBuild === build &&
			syncedCardBindingsResolver === resolver
		) {
			return false;
		}

		previewCardBindings.length = 0;
		interactionCardBindings.length = 0;
		for (const row of build?.rowSlices ?? EMPTY_MOUNTED_ROWS) {
			for (const cell of row.cells) {
				const model = resolveMountedCardModel(cell, resolver);
				if (!model) continue;
				const slotId = String(cell.renderSlotKey);
				const previewSnapshot = model.previewSnapshot;
				if (previewSnapshot) {
					previewCardBindings.push({
						slotId,
						rowIndex: cell.rowIndex,
						snapshot: previewSnapshot,
					});
				}
				if (model.interactionDescriptor) {
					interactionCardBindings.push({
						slotId,
						descriptor: model.interactionDescriptor,
					});
				}
			}
		}
		interactionController.syncCards(interactionCardBindings);
		hasSyncedCardBindings = true;
		syncedCardBindingsBuild = build;
		syncedCardBindingsResolver = resolver;
		return true;
	};

	const syncCardBindings = (build: TwoHopMountedRowsBuild | null): void => {
		if (!refreshCardBindings(build)) return;
		previewController.syncBindings(previewCardBindings);
	};

	const syncPreviewAndVisibility = (params: {
		readonly rowModel: object;
		readonly mountedRange: RowRange;
		readonly previewRange: RowRange;
		readonly build: TwoHopMountedRowsBuild | null;
	}): void => {
		const active = props.previewActive !== false;
		const effectivePreviewRange = active ? params.previewRange : EMPTY_RANGE;
		previewController.setPreviewWindow({
			previewRange: params.previewRange,
			active,
		});
		visibilityStates.commit({
			rowModelRevision: params.rowModel,
			mountedRows: params.build?.rowSlices ?? EMPTY_MOUNTED_ROWS,
			mountedRange: params.mountedRange,
			previewActiveRange: effectivePreviewRange,
		});
	};

	const syncDisplaySnapshot = (params: {
		readonly rowModel: object;
		readonly mountedRange: RowRange;
		readonly previewRange: RowRange;
		readonly build: TwoHopMountedRowsBuild | null;
	}): void => {
		refreshCardBindings(params.build);
		const active = props.previewActive !== false;
		previewController.commit({
			cards: previewCardBindings,
			previewRange: params.previewRange,
			active,
		});
		visibilityStates.commit({
			rowModelRevision: params.rowModel,
			mountedRows: params.build?.rowSlices ?? EMPTY_MOUNTED_ROWS,
			mountedRange: params.mountedRange,
			previewActiveRange: active ? params.previewRange : EMPTY_RANGE,
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
				syncPreviewAndVisibility({
					rowModel: snapshot.rowModel,
					mountedRange: snapshot.ranges.mounted,
					previewRange: { start, end },
					build: virtualList.getReconciliationState().mountedBuild,
				});
			},
			cancelPreviewVisibleRangeSync() {
				const snapshot = virtualList.getSnapshot();
				if (!snapshot) return;
				syncPreviewAndVisibility({
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
		frameCoordinator,
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
		syncPreviewAndVisibility({
			rowModel: snapshot.rowModel,
			mountedRange: snapshot.ranges.mounted,
			previewRange: snapshot.ranges.previewVisible,
			build: virtualList.getReconciliationState().mountedBuild,
		});
	});

	$effect(() => {
		void props.resolveItemCardModel;
		syncCardBindings(virtualList.getReconciliationState().mountedBuild);
	});

	onDestroy(() => {
		previewController?.dispose();
		interactionController.clear();
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
		get interactionDescriptorResolverProvider() {
			return interactionController.provider;
		},
		getPreviewState(cell: TwoHopMountedCell) {
			return previewController?.getSlotState(String(cell.renderSlotKey));
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
