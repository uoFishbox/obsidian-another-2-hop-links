import { getContext, onDestroy, untrack } from "svelte";
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
	type TwoHopMountedRow,
	type TwoHopMountedRowsBuild,
} from "features/two-hop/ui/twoHopMountedRows";
import { createResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import { createVirtualSurfaceResidentRowsAdapter } from "ui/virtualization/svelte/residentRowViewState.svelte";
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
import type { PreviewBackpressure } from "features/preview/scheduling/previewActivationScheduler";
import {
	createVirtualPreviewSurface,
	type RowPreviewWindow,
} from "features/preview/scheduling/virtualPreviewSurface";
import { resolveTwoHopItemStaticState } from "features/two-hop/ui/twoHopCellStaticState";
import { createVirtualCardInteractionController } from "ui/interactions/virtualCardInteractionController";
import { useAppContext, useLinkContext } from "ui/context/linkContext";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualNavigationTarget } from "ui/virtualization/types";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
	resolvePreviewActivationsPerSecond,
} from "appConstants";
import { DEFAULT_SETTINGS } from "features/settings/model";
import {
	createVirtualCardSlotBindings,
	type VirtualCardSlotBinding,
	type VirtualCardSlotState,
} from "ui/virtualization/svelte/virtualCardSlotBindings.svelte";
import {
	createLayoutPublication,
	type TwoHopLayoutPublication,
} from "features/two-hop/ui/twoHopRevisions";

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

export type TwoHopRenderSlotBinding = VirtualCardSlotBinding<
	TwoHopMountedCell,
	CardRenderModel
>;
export type TwoHopRenderSlotState = VirtualCardSlotState<
	TwoHopMountedCell,
	CardRenderModel
>;

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
	let appContext: ReturnType<typeof useAppContext> | undefined;
	try {
		appContext = useAppContext();
	} catch {
		appContext = undefined;
	}
	const previewApplicationStore = applicationStore ?? appContext?.applicationStore;
	const previewSurface = createVirtualPreviewSurface({
		app: appContext?.app,
		getPreview: linkContext?.getPreview,
		getSettings: () => previewApplicationStore?.settings ?? DEFAULT_SETTINGS,
		getPreviewRenderVersion: (filePath) =>
			previewApplicationStore?.getPreviewRenderVersion?.(filePath) ?? "0:0",
		resolveSearchMatchPosition: appContext?.resolveSearchMatchPosition,
		getBackpressure: (): PreviewBackpressure => ({
			queued: linkContext?.getVisiblePreviewQueueSize?.() ?? 0,
			active: linkContext?.getActiveVisiblePreviewCount?.() ?? 0,
		}),
		subscribeBackpressure: linkContext?.subscribeVisiblePreviewQueue,
		schedulerIdentity: linkContext?.previewSchedulingIdentity,
		frameCoordinator,
		getActivationsPerSecond: () =>
			resolvePreviewActivationsPerSecond(
				previewApplicationStore?.settings.previewDomCommitsPerSecond ??
					DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
			),
		getDomCommitsPerSecond: () =>
			previewApplicationStore?.settings.previewDomCommitsPerSecond ??
			DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
	});
	const interactionController = createVirtualCardInteractionController();
	const documentProjection = createTwoHopDocumentProjection({
		sections: props.sections,
		applicationStore,
		initialVisibleCount: props.initialVisibleCount,
		loadMoreIncrement: props.loadMoreIncrement,
	});
	let document = $state.raw<TwoHopDocument>(documentProjection.getDocument());
	const measurementState = createViewPlanMeasurementState();
	const rowSlotAllocator = createResidentRowSlotAllocator();
	const residentRowsAdapter = createVirtualSurfaceResidentRowsAdapter<
		TwoHopMountedCell,
		TwoHopMountedRow
	>();
	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore?.settings),
	);

	let cachedDocument: TwoHopDocument | undefined;
	let cachedLayoutPublication: TwoHopLayoutPublication | undefined;
	let cachedRowModel: TwoHopVirtualRowModel | undefined;
	let layoutRevisionValue = 0;
	let publishedLayout: ViewPlanLayoutMetrics | undefined;
	let layoutPublication: TwoHopLayoutPublication | undefined;
	const resolveLayoutPublication = (
		layout: ViewPlanLayoutMetrics,
	): TwoHopLayoutPublication => {
		if (
			publishedLayout &&
			layoutPublication &&
			isSameViewPlanLayout(publishedLayout, layout)
		) {
			return layoutPublication;
		}
		publishedLayout = { ...layout };
		layoutPublication = createLayoutPublication(layout, ++layoutRevisionValue);
		return layoutPublication;
	};
	const resolveRowModel = (
		layout: ViewPlanLayoutMetrics = measurementState.layout,
	): TwoHopVirtualRowModel => {
		const nextLayoutPublication = resolveLayoutPublication(layout);
		if (
			cachedRowModel &&
			cachedDocument?.revision === document.revision &&
			cachedLayoutPublication?.revision === nextLayoutPublication.revision
		) {
			return cachedRowModel;
		}
		cachedDocument = document;
		cachedLayoutPublication = nextLayoutPublication;
		cachedRowModel = createTwoHopVirtualRowModel(document, nextLayoutPublication);
		return cachedRowModel;
	};
	const rowModel = $derived(resolveRowModel());

	let residentRowsBuild: TwoHopMountedRowsBuild | null = null;

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

	const cardSlotBindings = createVirtualCardSlotBindings<
		TwoHopMountedCell,
		CardRenderModel,
		TwoHopVirtualListProps["resolveItemCardModel"]
	>({
		previewSurface,
		interactionController,
		resolveBinding: (mountedCell, resolver) => {
			const cardModel = resolveMountedCardModel(mountedCell, resolver);
			return {
				mountedCell,
				cardModel,
				preview: cardModel?.previewSnapshot ?? undefined,
				interaction: cardModel?.interactionDescriptor ?? undefined,
			};
		},
	});

	const syncResidentRows = (build: TwoHopMountedRowsBuild | null): void => {
		if (residentRowsBuild === build) return;
		residentRowsAdapter.sync(
			build?.rowsBySlot ?? EMPTY_MOUNTED_ROWS,
			rowSlotAllocator.capacity,
		);
		residentRowsBuild = build;
	};

	const syncCardSlots = (
		build: TwoHopMountedRowsBuild | null,
		resolver: TwoHopVirtualListProps["resolveItemCardModel"],
		previewWindow: RowPreviewWindow,
	): void => {
		cardSlotBindings.sync({
			mountedCells: build?.cells ?? EMPTY_MOUNTED_ROWS,
			capacity: build?.nextRenderSlotIndex ?? 0,
			bindingIdentity: resolver,
			previewWindow,
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
			const mountedBuild = reconciliationState.mountedBuild;
			syncResidentRows(mountedBuild);
			syncCardSlots(
				mountedBuild,
				untrack(() => props.resolveItemCardModel),
				{
					previewRange: snapshot.ranges.previewVisible,
					active: untrack(() => props.previewActive !== false),
				},
			);
		},
	});

	const policyResolver = createViewPlanCardVirtualListPolicyResolver({
		getPreviewActivationAheadRows: () =>
			applicationStore?.settings?.previewActivationAheadRows ?? 1,
		getMountedOverscanRows: () =>
			applicationStore?.settings?.enableTwoRowMountedOverscan ? 2 : 1,
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
			cancelPreviewVisibleRangeSync() {
				const snapshot = virtualList.getSnapshot();
				if (!snapshot) return;
				previewSurface.setPreviewWindow({
					previewRange: EMPTY_RANGE,
					active: untrack(() => props.previewActive !== false),
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
		const resolver = props.resolveItemCardModel;
		const active = props.previewActive !== false;
		const build = untrack(() => virtualList.getReconciliationState().mountedBuild);
		const snapshot = untrack(() => virtualList.getSnapshot());
		if (!snapshot) return;
		syncCardSlots(build, resolver, {
			previewRange: snapshot.ranges.previewVisible,
			active,
		});
	});

	onDestroy(() => {
		previewSurface.dispose();
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
		get residentRows() {
			return residentRowsAdapter.rows;
		},
		get interactionDescriptorResolverProvider() {
			return interactionController.provider;
		},
		get previewSurface() {
			return previewSurface;
		},
		getRenderSlotState(cell: TwoHopMountedCell) {
			return cardSlotBindings.getSlotState(cell);
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
