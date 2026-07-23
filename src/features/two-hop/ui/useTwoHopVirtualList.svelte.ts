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
import { createTwoHopResidentRowSlotAllocator } from "features/two-hop/ui/twoHopResidentRowSlotAllocator";
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
	type RowPreviewCardBinding,
} from "features/preview/scheduling/virtualPreviewSurface";
import { resolveTwoHopItemStaticState } from "features/two-hop/ui/twoHopCellStaticState";
import {
	createVirtualCardInteractionController,
	type VirtualCardInteractionBinding,
} from "ui/interactions/virtualCardInteractionController";
import { useAppContext, useLinkContext } from "ui/context/linkContext";
import type { RowRange } from "ui/virtualization/rowRange";
import type { RenderSlotKey, VirtualNavigationTarget } from "ui/virtualization/types";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
	resolvePreviewActivationsPerSecond,
} from "appConstants";
import { DEFAULT_SETTINGS } from "features/settings/model";

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

/** Reactive display state owned by one physical render slot. */
export interface TwoHopRenderSlotState {
	cell: TwoHopMountedCell | undefined;
	cardModel: CardRenderModel | undefined;
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
	const rowSlotAllocator = createTwoHopResidentRowSlotAllocator();
	const residentRowsAdapter = createVirtualSurfaceResidentRowsAdapter<
		TwoHopMountedCell,
		TwoHopMountedRow
	>();
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
	const previewBindingsBySlot: Array<RowPreviewCardBinding | undefined> = [];
	const interactionBindingsBySlot: Array<VirtualCardInteractionBinding | undefined> =
		[];
	const renderSlotStates: TwoHopRenderSlotState[] = [];
	const previewBindingDelta: {
		enteredSlots: RowPreviewCardBinding[];
		reboundSlots: RowPreviewCardBinding[];
		releasedSlots: string[];
	} = {
		enteredSlots: [],
		reboundSlots: [],
		releasedSlots: [],
	};
	const interactionBindingDelta: {
		enteredSlots: VirtualCardInteractionBinding[];
		reboundSlots: VirtualCardInteractionBinding[];
		releasedSlots: string[];
	} = {
		enteredSlots: [],
		reboundSlots: [],
		releasedSlots: [],
	};
	const changedCellsScratch: TwoHopMountedCell[] = [];
	const releasedSlotsScratch: RenderSlotKey[] = [];

	const ensureRenderSlotCapacity = (capacity: number): void => {
		while (renderSlotStates.length < capacity) {
			renderSlotStates.push(createTwoHopRenderSlotState());
		}
	};

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

	const clearBindingDelta = (): void => {
		previewBindingDelta.enteredSlots.length = 0;
		previewBindingDelta.reboundSlots.length = 0;
		previewBindingDelta.releasedSlots.length = 0;
		interactionBindingDelta.enteredSlots.length = 0;
		interactionBindingDelta.reboundSlots.length = 0;
		interactionBindingDelta.releasedSlots.length = 0;
		changedCellsScratch.length = 0;
		releasedSlotsScratch.length = 0;
	};

	const updateChangedSlot = (
		cell: TwoHopMountedCell,
		resolver: TwoHopVirtualListProps["resolveItemCardModel"],
	): void => {
		const slotIndex = cell.renderSlotIndex;
		const slotState = renderSlotStates[slotIndex];
		if (!slotState) return;
		const previousModel = slotState.cardModel;
		const model = resolveMountedCardModel(cell, resolver);
		if (slotState.cell !== cell) slotState.cell = cell;
		if (previousModel !== model) slotState.cardModel = model;

		const previousPreview = previousModel?.previewSnapshot;
		const previewSnapshot = model?.previewSnapshot;
		if (previewSnapshot) {
			let binding = previewBindingsBySlot[slotIndex];
			if (!binding) {
				binding = {
					slotId: String(cell.renderSlotKey),
					rowIndex: cell.rowIndex,
					snapshot: previewSnapshot,
				};
				previewBindingsBySlot[slotIndex] = binding;
			} else {
				if (binding.rowIndex !== cell.rowIndex)
					binding.rowIndex = cell.rowIndex;
				if (binding.snapshot !== previewSnapshot)
					binding.snapshot = previewSnapshot;
			}
			(previousPreview
				? previewBindingDelta.reboundSlots
				: previewBindingDelta.enteredSlots
			).push(binding);
		} else if (previousPreview) {
			previewBindingDelta.releasedSlots.push(String(cell.renderSlotKey));
		}

		const previousInteraction = previousModel?.interactionDescriptor;
		const interactionDescriptor = model?.interactionDescriptor;
		if (interactionDescriptor) {
			let binding = interactionBindingsBySlot[slotIndex];
			if (!binding) {
				binding = {
					slotId: String(cell.renderSlotKey),
					descriptor: interactionDescriptor,
				};
				interactionBindingsBySlot[slotIndex] = binding;
			} else if (binding.descriptor !== interactionDescriptor) {
				binding.descriptor = interactionDescriptor;
			}
			(previousInteraction
				? interactionBindingDelta.reboundSlots
				: interactionBindingDelta.enteredSlots
			).push(binding);
		} else if (previousInteraction) {
			interactionBindingDelta.releasedSlots.push(String(cell.renderSlotKey));
		}
	};

	const releaseSlot = (renderSlotKey: RenderSlotKey): void => {
		const slotIndex = Number(renderSlotKey);
		const slotState = renderSlotStates[slotIndex];
		if (!slotState) return;
		const previousModel = slotState.cardModel;
		const slotId = String(renderSlotKey);
		if (previousModel?.previewSnapshot) {
			previewBindingDelta.releasedSlots.push(slotId);
		}
		if (previousModel?.interactionDescriptor) {
			interactionBindingDelta.releasedSlots.push(slotId);
		}
		if (slotState.cell !== undefined) slotState.cell = undefined;
		if (slotState.cardModel !== undefined) slotState.cardModel = undefined;
	};

	const refreshCardBindings = (
		build: TwoHopMountedRowsBuild | null,
		resolver: TwoHopVirtualListProps["resolveItemCardModel"],
	): boolean => {
		if (
			hasSyncedCardBindings &&
			syncedCardBindingsBuild === build &&
			syncedCardBindingsResolver === resolver
		) {
			return false;
		}

		clearBindingDelta();
		ensureRenderSlotCapacity(build?.nextRenderSlotIndex ?? 0);
		const resolverChanged = syncedCardBindingsResolver !== resolver;
		const canApplyBuildDelta =
			build !== null &&
			build.deltaBaseIdentity === (syncedCardBindingsBuild?.identity ?? null);
		if (build && canApplyBuildDelta) {
			for (const renderSlotKey of build.slotDelta.releasedSlots) {
				releasedSlotsScratch.push(renderSlotKey);
			}
		} else if (syncedCardBindingsBuild) {
			for (const row of syncedCardBindingsBuild.rowSlices) {
				for (const cell of row.cells)
					releasedSlotsScratch.push(cell.renderSlotKey);
			}
		}
		if (resolverChanged || !canApplyBuildDelta) {
			for (const row of build?.rowSlices ?? EMPTY_MOUNTED_ROWS) {
				for (const cell of row.cells) changedCellsScratch.push(cell);
			}
		} else if (build) {
			for (const cell of build.slotDelta.enteredSlots) {
				changedCellsScratch.push(cell);
			}
			for (const cell of build.slotDelta.reboundSlots) {
				changedCellsScratch.push(cell);
			}
		}
		for (const renderSlotKey of releasedSlotsScratch) releaseSlot(renderSlotKey);
		for (const cell of changedCellsScratch) updateChangedSlot(cell, resolver);
		const nextCapacity = build?.nextRenderSlotIndex ?? 0;
		if (renderSlotStates.length > nextCapacity) {
			renderSlotStates.length = nextCapacity;
			previewBindingsBySlot.length = nextCapacity;
			interactionBindingsBySlot.length = nextCapacity;
		}
		interactionController.syncCardDelta(interactionBindingDelta);
		hasSyncedCardBindings = true;
		syncedCardBindingsBuild = build;
		syncedCardBindingsResolver = resolver;
		return true;
	};

	const syncCardBindings = (
		build: TwoHopMountedRowsBuild | null,
		resolver: TwoHopVirtualListProps["resolveItemCardModel"],
	): void => {
		if (!refreshCardBindings(build, resolver)) return;
		previewSurface.syncBindingDelta(previewBindingDelta);
	};

	const syncDisplaySnapshot = (params: {
		readonly previewRange: RowRange;
		readonly build: TwoHopMountedRowsBuild | null;
		readonly resolver: TwoHopVirtualListProps["resolveItemCardModel"];
		readonly active: boolean;
	}): void => {
		const bindingsChanged = refreshCardBindings(params.build, params.resolver);
		if (!bindingsChanged) {
			previewSurface.setPreviewWindow({
				previewRange: params.previewRange,
				active: params.active,
			});
			return;
		}
		previewSurface.commitBindingDelta(previewBindingDelta, {
			previewRange: params.previewRange,
			active: params.active,
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
			const { resolver, active } = untrack(() => ({
				resolver: props.resolveItemCardModel,
				active: props.previewActive !== false,
			}));
			residentRowsAdapter.sync(
				reconciliationState.mountedBuild?.rowsBySlot ?? EMPTY_MOUNTED_ROWS,
				rowSlotAllocator.capacity,
			);
			syncDisplaySnapshot({
				previewRange: snapshot.ranges.previewVisible,
				build: reconciliationState.mountedBuild,
				resolver,
				active,
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
		const active = props.previewActive !== false;
		const snapshot = untrack(() => virtualList.getSnapshot());
		if (!snapshot) return;
		previewSurface.setPreviewWindow({
			previewRange: snapshot.ranges.previewVisible,
			active,
		});
	});

	$effect(() => {
		const resolver = props.resolveItemCardModel;
		const build = untrack(() => virtualList.getReconciliationState().mountedBuild);
		syncCardBindings(build, resolver);
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
			const state = renderSlotStates[cell.renderSlotIndex];
			return state?.cell === cell ? state : undefined;
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

function createTwoHopRenderSlotState(): TwoHopRenderSlotState {
	let cell = $state.raw<TwoHopMountedCell | undefined>(undefined);
	let cardModel = $state.raw<CardRenderModel | undefined>(undefined);
	return {
		get cell() {
			return cell;
		},
		set cell(nextCell) {
			cell = nextCell;
		},
		get cardModel() {
			return cardModel;
		},
		set cardModel(nextCardModel) {
			cardModel = nextCardModel;
		},
	};
}
