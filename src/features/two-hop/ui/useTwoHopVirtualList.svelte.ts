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
	type TwoHopMountedRowDelta,
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
	type RowPreviewBindingDelta,
	type RowPreviewCardBinding,
	type RowPreviewWindow,
} from "features/preview/scheduling/virtualPreviewSurface";
import { resolveTwoHopItemStaticState } from "features/two-hop/ui/twoHopCellStaticState";
import {
	createVirtualCardInteractionController,
	type VirtualCardInteractionBinding,
	type VirtualCardInteractionDelta,
} from "ui/interactions/virtualCardInteractionController";
import { useAppContext, useLinkContext } from "ui/context/linkContext";
import type { RowRange } from "ui/virtualization/rowRange";
import {
	renderSlotKey,
	type RenderSlotKey,
	type VirtualNavigationTarget,
} from "ui/virtualization/types";
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

export interface TwoHopRenderSlotBinding {
	readonly cell: TwoHopMountedCell;
	readonly cardModel?: CardRenderModel;
}

/** Reactive display state owned by one physical render slot. */
export interface TwoHopRenderSlotState {
	binding: TwoHopRenderSlotBinding | undefined;
}

interface TwoHopCardShellChange {
	readonly slotIndex: number;
	readonly binding: TwoHopRenderSlotBinding | undefined;
}

/** Reactive card-shell changes prepared for one surface publication. */
export interface TwoHopCardShellDelta {
	readonly mountedBuild: TwoHopMountedRowsBuild | null;
	readonly resolver: TwoHopVirtualListProps["resolveItemCardModel"];
	readonly nextCapacity: number;
	readonly changes: readonly TwoHopCardShellChange[];
}

/** All TwoHop surface state published by one virtual-list snapshot update. */
export interface TwoHopSurfaceCommit {
	readonly generation: number;
	readonly mountedBuild: TwoHopMountedRowsBuild | null;
	readonly rowDelta: TwoHopMountedRowDelta | null;
	readonly shellDelta: TwoHopCardShellDelta | null;
	readonly interactionDelta: VirtualCardInteractionDelta | null;
	readonly previewDelta: RowPreviewBindingDelta | null;
	readonly previewWindow: RowPreviewWindow;
}

const EMPTY_RANGE: RowRange = { start: 0, end: 0 };
const EMPTY_MOUNTED_ROWS: readonly [] = [];
const EMPTY_PREVIEW_DELTA: RowPreviewBindingDelta = {
	enteredSlots: [],
	reboundSlots: [],
	releasedSlots: [],
};

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
	const renderSlotStates: TwoHopRenderSlotState[] = [];
	let residentRowsBuild: TwoHopMountedRowsBuild | null = null;
	let nextSurfaceCommitGeneration = 1;
	let committedSurfaceGeneration = 0;

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

	const prepareCardBindingDeltas = (
		build: TwoHopMountedRowsBuild | null,
		resolver: TwoHopVirtualListProps["resolveItemCardModel"],
	): {
		readonly shellDelta: TwoHopCardShellDelta | null;
		readonly previewDelta: RowPreviewBindingDelta | null;
		readonly interactionDelta: VirtualCardInteractionDelta | null;
	} => {
		if (
			hasSyncedCardBindings &&
			syncedCardBindingsBuild === build &&
			syncedCardBindingsResolver === resolver
		) {
			return {
				shellDelta: null,
				previewDelta: null,
				interactionDelta: null,
			};
		}

		const shellChangesBySlot = new Map<
			number,
			TwoHopRenderSlotBinding | undefined
		>();
		const enteredPreviewSlots: RowPreviewCardBinding[] = [];
		const reboundPreviewSlots: RowPreviewCardBinding[] = [];
		const releasedPreviewSlots: string[] = [];
		const enteredInteractionSlots: VirtualCardInteractionBinding[] = [];
		const reboundInteractionSlots: VirtualCardInteractionBinding[] = [];
		const releasedInteractionSlots: string[] = [];
		const changedCells: TwoHopMountedCell[] = [];
		const releasedSlots: RenderSlotKey[] = [];
		const resolverChanged = syncedCardBindingsResolver !== resolver;
		const canApplyBuildDelta =
			build !== null &&
			build.deltaBaseIdentity === (syncedCardBindingsBuild?.identity ?? null);
		if (build && canApplyBuildDelta) {
			for (const renderSlotKey of build.slotDelta.releasedSlots) {
				releasedSlots.push(renderSlotKey);
			}
		} else if (syncedCardBindingsBuild) {
			for (const row of syncedCardBindingsBuild.rowSlices) {
				for (const cell of row.cells) releasedSlots.push(cell.renderSlotKey);
			}
		}
		if (resolverChanged || !canApplyBuildDelta) {
			for (const row of build?.rowSlices ?? EMPTY_MOUNTED_ROWS) {
				for (const cell of row.cells) changedCells.push(cell);
			}
		} else if (build) {
			for (const cell of build.slotDelta.enteredSlots) {
				changedCells.push(cell);
			}
			for (const cell of build.slotDelta.reboundSlots) {
				changedCells.push(cell);
			}
		}

		const getPreparedBinding = (
			slotIndex: number,
		): TwoHopRenderSlotBinding | undefined =>
			shellChangesBySlot.has(slotIndex)
				? shellChangesBySlot.get(slotIndex)
				: renderSlotStates[slotIndex]?.binding;
		const releaseSlot = (renderSlotKey: RenderSlotKey): void => {
			const slotIndex = Number(renderSlotKey);
			const previousModel = getPreparedBinding(slotIndex)?.cardModel;
			const slotId = String(renderSlotKey);
			if (previousModel?.previewSnapshot) releasedPreviewSlots.push(slotId);
			if (previousModel?.interactionDescriptor)
				releasedInteractionSlots.push(slotId);
			shellChangesBySlot.set(slotIndex, undefined);
		};
		for (const renderSlotKey of releasedSlots) releaseSlot(renderSlotKey);

		for (const cell of changedCells) {
			const slotIndex = cell.renderSlotIndex;
			const previousBinding = getPreparedBinding(slotIndex);
			const previousModel = previousBinding?.cardModel;
			const model = resolveMountedCardModel(cell, resolver);
			if (previousBinding?.cell !== cell || previousModel !== model) {
				shellChangesBySlot.set(slotIndex, { cell, cardModel: model });
			}

			const slotId = String(cell.renderSlotKey);
			const previewSnapshot = model?.previewSnapshot;
			if (previewSnapshot) {
				const binding = {
					slotId,
					rowIndex: cell.rowIndex,
					snapshot: previewSnapshot,
				};
				(previousModel?.previewSnapshot
					? reboundPreviewSlots
					: enteredPreviewSlots
				).push(binding);
			} else if (previousModel?.previewSnapshot) {
				releasedPreviewSlots.push(slotId);
			}

			const interactionDescriptor = model?.interactionDescriptor;
			if (interactionDescriptor) {
				const binding = { slotId, descriptor: interactionDescriptor };
				(previousModel?.interactionDescriptor
					? reboundInteractionSlots
					: enteredInteractionSlots
				).push(binding);
			} else if (previousModel?.interactionDescriptor) {
				releasedInteractionSlots.push(slotId);
			}
		}

		const nextCapacity = build?.nextRenderSlotIndex ?? 0;
		for (
			let slotIndex = nextCapacity;
			slotIndex < renderSlotStates.length;
			slotIndex += 1
		) {
			if (!shellChangesBySlot.has(slotIndex)) {
				releaseSlot(renderSlotKey(slotIndex));
			}
		}

		const shellDelta: TwoHopCardShellDelta = {
			mountedBuild: build,
			resolver,
			nextCapacity,
			changes: Array.from(shellChangesBySlot, ([slotIndex, binding]) => ({
				slotIndex,
				binding,
			})),
		};
		const previewDelta: RowPreviewBindingDelta = {
			enteredSlots: enteredPreviewSlots,
			reboundSlots: reboundPreviewSlots,
			releasedSlots: releasedPreviewSlots,
		};
		const interactionDelta: VirtualCardInteractionDelta = {
			enteredSlots: enteredInteractionSlots,
			reboundSlots: reboundInteractionSlots,
			releasedSlots: releasedInteractionSlots,
		};
		return { shellDelta, previewDelta, interactionDelta };
	};

	const applyResidentRowDelta = (
		build: TwoHopMountedRowsBuild | null,
		delta: TwoHopMountedRowDelta | null,
	): void => {
		if (residentRowsBuild === build) return;
		if (build && delta) {
			residentRowsAdapter.applyDelta(delta, rowSlotAllocator.capacity);
		} else {
			residentRowsAdapter.sync(
				build?.rowsBySlot ?? EMPTY_MOUNTED_ROWS,
				rowSlotAllocator.capacity,
			);
		}
		residentRowsBuild = build;
	};

	const applyCardShellDelta = (delta: TwoHopCardShellDelta | null): void => {
		if (!delta) return;
		ensureRenderSlotCapacity(delta.nextCapacity);
		for (const change of delta.changes) {
			const slotState = renderSlotStates[change.slotIndex];
			if (slotState && slotState.binding !== change.binding) {
				slotState.binding = change.binding;
			}
		}
		if (renderSlotStates.length > delta.nextCapacity) {
			renderSlotStates.length = delta.nextCapacity;
		}
		hasSyncedCardBindings = true;
		syncedCardBindingsBuild = delta.mountedBuild;
		syncedCardBindingsResolver = delta.resolver;
	};

	const commitSurface = (commit: TwoHopSurfaceCommit): void => {
		if (commit.generation <= committedSurfaceGeneration) return;
		committedSurfaceGeneration = commit.generation;
		applyResidentRowDelta(commit.mountedBuild, commit.rowDelta);
		applyCardShellDelta(commit.shellDelta);
		if (commit.interactionDelta) {
			interactionController.syncCardDelta(commit.interactionDelta);
		}
		previewSurface.commitBindingDelta(
			commit.previewDelta ?? EMPTY_PREVIEW_DELTA,
			commit.previewWindow,
		);
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
			const cardDeltas = prepareCardBindingDeltas(
				mountedBuild,
				untrack(() => props.resolveItemCardModel),
			);
			const canApplyRowDelta =
				mountedBuild !== null &&
				mountedBuild !== residentRowsBuild &&
				mountedBuild.deltaBaseIdentity ===
					(residentRowsBuild?.identity ?? null);
			commitSurface({
				generation: nextSurfaceCommitGeneration++,
				mountedBuild,
				rowDelta: canApplyRowDelta ? mountedBuild.rowDelta : null,
				shellDelta: cardDeltas.shellDelta,
				interactionDelta: cardDeltas.interactionDelta,
				previewDelta: cardDeltas.previewDelta,
				previewWindow: {
					previewRange: snapshot.ranges.previewVisible,
					active: untrack(() => props.previewActive !== false),
				},
			});
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
		const cardDeltas = prepareCardBindingDeltas(build, resolver);
		if (!cardDeltas.shellDelta) return;
		const snapshot = untrack(() => virtualList.getSnapshot());
		commitSurface({
			generation: nextSurfaceCommitGeneration++,
			mountedBuild: build,
			rowDelta: null,
			shellDelta: cardDeltas.shellDelta,
			interactionDelta: cardDeltas.interactionDelta,
			previewDelta: cardDeltas.previewDelta,
			previewWindow: {
				previewRange: snapshot?.ranges.previewVisible ?? EMPTY_RANGE,
				active: untrack(() => props.previewActive !== false),
			},
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
			const state = renderSlotStates[cell.renderSlotIndex];
			return state?.binding?.cell === cell ? state : undefined;
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
	let binding = $state.raw<TwoHopRenderSlotBinding | undefined>(undefined);
	return {
		get binding() {
			return binding;
		},
		set binding(nextBinding) {
			binding = nextBinding;
		},
	};
}
