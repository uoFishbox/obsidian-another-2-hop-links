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
import type { RenderSlotKey, VirtualNavigationTarget } from "ui/virtualization/types";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import type { CardPreviewSlotState } from "features/preview/ui/cardPreviewSnapshot";
import {
	DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
	resolvePreviewActivationsPerSecond,
} from "appConstants";

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
	previewState: CardPreviewSlotState | undefined;
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
		getActivationsPerSecond: () =>
			resolvePreviewActivationsPerSecond(
				applicationStore?.settings.previewDomCommitsPerSecond ??
					DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
			),
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
			if (slotState.previewState !== undefined)
				slotState.previewState = undefined;
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
		if (slotState.previewState !== undefined) slotState.previewState = undefined;
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

		clearBindingDelta();
		ensureRenderSlotCapacity(build?.nextRenderSlotIndex ?? 0);
		const resolverChanged = syncedCardBindingsResolver !== resolver;
		const canApplyBuildDelta =
			build !== null &&
			build.deltaBaseIdentity === (syncedCardBindingsBuild?.identity ?? null);
		if (build && canApplyBuildDelta) {
			releasedSlotsScratch.push(...build.slotDelta.releasedSlots);
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
			changedCellsScratch.push(
				...build.slotDelta.enteredSlots,
				...build.slotDelta.reboundSlots,
			);
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

	const syncRenderSlotPreviewStates = (): void => {
		for (const cell of changedCellsScratch) {
			const slotState = renderSlotStates[cell.renderSlotIndex];
			if (!slotState || slotState.cell !== cell) continue;
			const previewState = previewController.getSlotState(
				String(cell.renderSlotKey),
			);
			if (slotState.previewState !== previewState) {
				slotState.previewState = previewState;
			}
		}
	};

	const syncCardBindings = (build: TwoHopMountedRowsBuild | null): void => {
		if (!refreshCardBindings(build)) return;
		previewController.syncBindingDelta(previewBindingDelta);
		syncRenderSlotPreviewStates();
	};

	const syncPreviewWindow = (params: { readonly previewRange: RowRange }): void => {
		const active = props.previewActive !== false;
		previewController.setPreviewWindow({
			previewRange: params.previewRange,
			active,
		});
	};

	const syncDisplaySnapshot = (params: {
		readonly previewRange: RowRange;
		readonly build: TwoHopMountedRowsBuild | null;
	}): void => {
		const bindingsChanged = refreshCardBindings(params.build);
		const active = props.previewActive !== false;
		if (!bindingsChanged) {
			previewController.setPreviewWindow({
				previewRange: params.previewRange,
				active,
			});
			return;
		}
		previewController.commitBindingDelta(previewBindingDelta, {
			previewRange: params.previewRange,
			active,
		});
		syncRenderSlotPreviewStates();
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
				syncPreviewWindow({
					previewRange: { start, end },
				});
			},
			cancelPreviewVisibleRangeSync() {
				const snapshot = virtualList.getSnapshot();
				if (!snapshot) return;
				syncPreviewWindow({
					previewRange: EMPTY_RANGE,
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
		syncPreviewWindow({
			previewRange: snapshot.ranges.previewVisible,
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
	let previewState = $state.raw<CardPreviewSlotState | undefined>(undefined);
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
		get previewState() {
			return previewState;
		},
		set previewState(nextPreviewState) {
			previewState = nextPreviewState;
		},
	};
}
