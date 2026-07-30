import { onDestroy, untrack } from "svelte";
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
import { createResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
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
import {
	createVirtualPreviewSurface,
	type RowPreviewWindow,
	type VirtualPreviewSurface,
} from "features/preview/scheduling/virtualPreviewSurface";
import { resolveTwoHopCardPresentation } from "features/two-hop/ui/twoHopCellStaticState";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualNavigationTarget } from "ui/virtualization/types";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	createLayoutPublication,
	type TwoHopLayoutPublication,
} from "features/two-hop/ui/twoHopRevisions";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { createTwoHopCardModelPrewarmer } from "features/two-hop/ui/twoHopCardModelPrewarmer";
import { createVirtualSurfaceResidentRowsAdapter } from "ui/virtualization/svelte/residentRowViewState.svelte";
import {
	compileTwoHopVirtualFrame,
	createEmptyTwoHopVirtualFrame,
	createTwoHopFrameInteractionProvider,
	type CommittedTwoHopVirtualFrame,
	type TwoHopCommittedCellBinding,
	type TwoHopCommittedRow,
} from "features/two-hop/ui/twoHopVirtualFrame";

export interface TwoHopVirtualListProps {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly applicationStore: ApplicationStore;
	readonly previewDependencies?: TwoHopPreviewDependencies;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly paginationScope?: string;
	readonly previewActive?: boolean;
	readonly resolveItemCardModel?: (
		item: TwoHopVirtualListItem,
		presentation: TwoHopCardPresentationState,
	) => CardRenderModel;
}

const EMPTY_RANGE: RowRange = { start: 0, end: 0 };

function createDisabledVirtualPreviewSurface(): VirtualPreviewSurface {
	return {
		registerHost: () => ({
			dispose: () => {},
		}),
		acceptCommittedFrame: () => {},
		syncBindingDelta: () => {},
		setPreviewWindow: () => {},
		commitBindingDelta: () => {},
		dispose: () => {},
	};
}

/** Connects TwoHop geometry to the shared pooled-row virtual surface. */
export function useTwoHopVirtualList(
	props: TwoHopVirtualListProps,
	frameCoordinator?: VirtualFrameCoordinator,
) {
	const applicationStore = props.applicationStore;
	const previewSurface = props.previewDependencies
		? createVirtualPreviewSurface({
				...props.previewDependencies,
				frameCoordinator,
			})
		: createDisabledVirtualPreviewSurface();
	const isPreviewActive = () =>
		props.previewDependencies !== undefined && props.previewActive !== false;
	const documentProjection = createTwoHopDocumentProjection({
		sections: props.sections,
		applicationStore,
		initialVisibleCount: props.initialVisibleCount,
		loadMoreIncrement: props.loadMoreIncrement,
		paginationScope: props.paginationScope,
	});
	let document = $state.raw<TwoHopDocument>(documentProjection.getDocument());
	const measurementState = createViewPlanMeasurementState();
	const rowSlotAllocator = createResidentRowSlotAllocator();
	let committedFrame = $state.raw<CommittedTwoHopVirtualFrame>(
		createEmptyTwoHopVirtualFrame(measurementState.layout),
	);
	const residentRowsAdapter = createVirtualSurfaceResidentRowsAdapter<
		TwoHopCommittedCellBinding,
		TwoHopCommittedRow
	>();
	const previewFrameSource = {
		get current() {
			return committedFrame;
		},
	};
	const interactionDescriptorResolverProvider = createTwoHopFrameInteractionProvider(
		() => committedFrame,
	);
	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore.settings),
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

	let committedMountedBuild: TwoHopMountedRowsBuild | null | undefined;
	let committedBindingIdentity:
		| TwoHopVirtualListProps["resolveItemCardModel"]
		| undefined;
	let committedPreviewRange: RowRange | undefined;
	let committedPreviewActive: boolean | undefined;

	const resolveMountedCardModel = (
		cell: TwoHopMountedCell,
		resolver: TwoHopVirtualListProps["resolveItemCardModel"],
	) => {
		if (cell.cell.kind !== "item" || !resolver) return undefined;
		return resolveCardModel(cell.cell.item, cell.section.header.section, resolver);
	};

	const resolveCardModel = (
		item: TwoHopVirtualListItem,
		section: TwoHopVirtualSectionDescriptor["section"],
		resolver: NonNullable<TwoHopVirtualListProps["resolveItemCardModel"]>,
	): CardRenderModel | undefined => {
		const presentation = resolveTwoHopCardPresentation(item, section);
		if (!presentation) return undefined;
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("twoHop.resolveItemCardModel.call");
		}
		return resolver(item, presentation);
	};
	const cardModelPrewarmer = createTwoHopCardModelPrewarmer({
		frameCoordinator,
	});

	const commitVirtualFrame = (
		build: TwoHopMountedRowsBuild | null,
		resolver: TwoHopVirtualListProps["resolveItemCardModel"],
		previewWindow: RowPreviewWindow,
	): void => {
		const { previewRange, active } = previewWindow;
		if (
			committedMountedBuild === build &&
			committedBindingIdentity === resolver &&
			committedPreviewActive === active &&
			committedPreviewRange?.start === previewRange.start &&
			committedPreviewRange.end === previewRange.end &&
			isSameViewPlanLayout(committedFrame.layout, measurementState.layout)
		) {
			return;
		}

		const previousFrame = committedFrame;
		const nextFrame = compileTwoHopVirtualFrame({
			previous: previousFrame,
			mountedBuild: build,
			layout: measurementState.layout,
			contentHeight:
				build?.rowModel.totalHeight ??
				resolveRowModel(measurementState.layout).totalHeight,
			previewWindow,
			bindingIdentity: resolver,
			resolveCardModel: (mountedCell) =>
				resolveMountedCardModel(mountedCell, resolver),
		});
		residentRowsAdapter.sync(nextFrame.rowSlots);
		committedFrame = nextFrame;
		committedMountedBuild = build;
		committedBindingIdentity = resolver;
		committedPreviewRange = {
			start: previewRange.start,
			end: previewRange.end,
		};
		committedPreviewActive = active;
		if (nextFrame.previewBindingsBySlot === previousFrame.previewBindingsBySlot) {
			previewSurface.setPreviewWindow(nextFrame.previewWindow);
		} else {
			previewSurface.acceptCommittedFrame(previewFrameSource);
		}
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
			commitVirtualFrame(
				mountedBuild,
				untrack(() => props.resolveItemCardModel),
				{
					previewRange: snapshot.ranges.previewVisible,
					active: untrack(isPreviewActive),
				},
			);
		},
	});

	const policyResolver = createViewPlanCardVirtualListPolicyResolver({
		getPreviewActivationAheadRows: () =>
			applicationStore.settings.previewActivationAheadRows,
		getMountedOverscanRows: () =>
			applicationStore.settings.enableTwoRowMountedOverscan ? 2 : 1,
	});
	const initialRowModel = resolveRowModel(measurementState.layout);
	if (initialRowModel.rowCount > 0) {
		virtualList.bootstrap({
			rowModel: initialRowModel,
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
				commitVirtualFrame(
					virtualList.getReconciliationState().mountedBuild,
					untrack(() => props.resolveItemCardModel),
					{
						previewRange: EMPTY_RANGE,
						active: untrack(isPreviewActive),
					},
				);
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
		publishDocument(
			documentProjection.setInput({
				sections: props.sections,
				paginationScope: props.paginationScope ?? "",
				initialVisibleCount: props.initialVisibleCount,
				loadMoreIncrement: props.loadMoreIncrement,
			}),
		);
	});

	$effect(() => {
		measurementRuntime.scheduleLayoutMeasurementForCardLayout(configuredLayout);
	});

	$effect(() => measurementRuntime.observeRootElement());

	$effect(() => {
		const resolver = props.resolveItemCardModel;
		const active = isPreviewActive();
		const build = untrack(() => virtualList.getReconciliationState().mountedBuild);
		const snapshot = untrack(() => virtualList.getSnapshot());
		if (!snapshot) return;
		commitVirtualFrame(build, resolver, {
			previewRange: snapshot.ranges.previewVisible,
			active,
		});
	});

	$effect(() => {
		const activeDocument = document;
		const resolver = props.resolveItemCardModel;
		if (!resolver) {
			cardModelPrewarmer.cancel();
			return;
		}
		cardModelPrewarmer.schedule(activeDocument, (item, section) => {
			resolveCardModel(item, section, resolver);
		});
	});

	onDestroy(() => {
		cardModelPrewarmer.dispose();
		previewSurface.dispose();
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
		get frame() {
			return committedFrame;
		},
		get residentRows() {
			return residentRowsAdapter.rows;
		},
		get interactionDescriptorResolverProvider() {
			return interactionDescriptorResolverProvider;
		},
		get previewSurface() {
			return previewSurface;
		},
		getCellDataTestId(binding: TwoHopCommittedCellBinding): string | undefined {
			switch (binding.mountedCell.cell.kind) {
				case "header":
					return `section-block-${binding.mountedCell.section.key}`;
				case "item":
					return "twohop-item-cell";
				case "load-more":
					return `load-more-${binding.mountedCell.section.key}`;
			}
		},
		loadMore,
		resolveNavigationTarget,
		flushVirtualScrollMeasurement: measurementRuntime.flushVirtualScrollMeasurement,
	};
}
