import { onDestroy, tick, untrack } from "svelte";
import type { TFile } from "obsidian";
import type { SearchContentMatch } from "search/searchTypes";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "two-hop/ui/twoHopSectionModel";
import {
	createTwoHopRowModel,
	type TwoHopRowModel,
	type TwoHopVirtualCell,
} from "./rowModel";
import {
	buildMountedTwoHopRows,
	type MountedTwoHopBuild,
	type MountedTwoHopRow,
} from "./mountedRows";
import { createTwoHopCardHydrator } from "./cardHydrator";
import type { PreviewRuntime } from "card-preview/runtime/previewRuntime";
import { DISABLED_PREVIEW_SURFACE } from "card-preview/runtime/previewRuntime";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { createResolvedCardLayoutSettingsMemo } from "cards/layout/cardLayoutCssVars";
import { resolveCardGridLayoutBase } from "cards/grid/layout/cardGridLayout";
import {
	DEFAULT_TWO_HOP_GRID_CARD_LAYOUT,
	DEFAULT_TWO_HOP_GRID_LAYOUT,
	isSameTwoHopGridLayout,
	type TwoHopGridLayout,
} from "./rowModel";
import { useVirtualizer } from "cards/virtualization/public";
import type { VirtualMeasurement } from "cards/virtualization/public";
import type { RowRange } from "cards/virtualization/public";
import type {
	NavigationDirection,
	SequentialNavigationDirection,
} from "cards/navigation/types";
import type { ProgrammaticScrollSnapshot } from "cards/virtualization/public";
import {
	buildTwoHopPreviewBindings,
	buildTwoHopInteractionBindings,
	collectTwoHopCardDemand,
} from "./mountedCardBindings";
import {
	captureTwoHopLayoutAnchor,
	restoreTwoHopLayoutAnchor,
	type TwoHopLayoutAnchor,
} from "./layoutAnchor";
import { createPreviewPrefetchRangeTracker } from "card-preview/prefetch/previewPrefetchRange";
import { createCardGridVisibilityPolicyResolver } from "cards/grid/model/cardGridVisibilityPolicy";
import { createVirtualCardInteractionController } from "cards/interactions/virtualCardInteractionController";
import type { InteractionHandle } from "cards/interactions/interactionTypes";

/** Dependencies required to enable previews on the two-hop virtual surface. */
export interface TwoHopPreviewDependencies {
	readonly previewRuntime: PreviewRuntime;
	readonly resolveSearchMatchOffset: (
		query: string,
		file: TFile | null | undefined,
	) => SearchContentMatch | undefined;
}

export interface TwoHopVirtualGridProps {
	readonly sections: readonly TwoHopSectionModel[];
	readonly applicationStore: CardCollectionState;
	/** Fixed for the lifetime of the virtual surface. */
	readonly previewDependencies?: TwoHopPreviewDependencies;
	readonly loadMoreSection?: (sectionId: string) => void;
	readonly previewActive?: boolean;
	readonly cardModelRevision: unknown;
	readonly resolveItemCardModel: (
		item: TwoHopItemModel,
		revision: unknown,
	) => CardRenderModel;
}

const EMPTY_RANGE: Readonly<RowRange> = Object.freeze({ start: 0, end: 0 });
const EMPTY_MOUNTED_ROWS: readonly MountedTwoHopRow[] = [];
const RANGE_EFFECT_TASK_KEY = "two-hop-virtual-range-effects";

/** Connects two-hop geometry and hydration to the shared bounded virtual-list runtime. */
export function useTwoHopVirtualGrid(
	props: TwoHopVirtualGridProps,
	frameCoordinator: VirtualFrameCoordinator,
) {
	const applicationStore = props.applicationStore;
	let layout = $state.raw<TwoHopGridLayout>(DEFAULT_TWO_HOP_GRID_LAYOUT);
	let rowModel = $state.raw<TwoHopRowModel>(
		createTwoHopRowModel({
			sections: props.sections,
			layout: DEFAULT_TWO_HOP_GRID_LAYOUT,
		}),
	);
	let rootEl = $state<HTMLDivElement | null>(null);
	let lastSections = props.sections;
	let lastCardModelRevision = props.cardModelRevision;
	let widthWasZero = false;
	let disposed = false;
	let pendingLayoutAnchor: TwoHopLayoutAnchor | null = null;
	let postCommitMeasurementScheduled = false;
	let previewVisibleRange: Readonly<RowRange> = EMPTY_RANGE;
	let previewPrefetchRange: Readonly<RowRange> = EMPTY_RANGE;
	let interactionBindingRevision = $state(0);
	const previewPrefetchRangeTracker = createPreviewPrefetchRangeTracker();
	const interactionController = createVirtualCardInteractionController();

	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore.settings),
	);
	const previewDependencies = props.previewDependencies;
	const previewSurface = previewDependencies
		? previewDependencies.previewRuntime.createSurface({
				frameCoordinator,
				resolveSearchMatchOffset: previewDependencies.resolveSearchMatchOffset,
			})
		: DISABLED_PREVIEW_SURFACE;

	function isPreviewSurfaceActive(): boolean {
		return previewDependencies !== undefined && props.previewActive !== false;
	}

	const resolveCardGridVisibilityPolicy = createCardGridVisibilityPolicyResolver();
	const resolveVisibilityPolicy = (model: TwoHopRowModel) =>
		resolveCardGridVisibilityPolicy(model.layout.rowStride);
	const cardHydrator = createTwoHopCardHydrator({
		frameCoordinator,
		getRevision: () => untrack(() => props.cardModelRevision),
		resolveCardModel: props.resolveItemCardModel,
		isPreviewActive: isPreviewSurfaceActive,
		onModelsChanged: syncMountedInteractions,
		onPreviewModelsChanged: publishPreviewSnapshot,
	});

	const virtualList = useVirtualizer<
		TwoHopVirtualCell,
		TwoHopRowModel,
		TwoHopRowModel,
		MountedTwoHopBuild
	>({
		getRootEl: () => rootEl,
		getContext: () => rowModel,
		hasRenderableContent: () => rowModel.rowCount > 0,
		resolveRowModel: (model) => model,
		resolveVisibilityPolicy,
		buildMountedRows: ({
			rowModel: nextRowModel,
			rowRange,
			previousBuild,
			rowSlotAllocator,
		}) =>
			buildMountedTwoHopRows({
				rowModel: nextRowModel,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			}),
		onSnapshotUpdated: (snapshot) => {
			syncMountedInteractions(
				snapshot.mountedBuild?.rowsInMountedRange ?? EMPTY_MOUNTED_ROWS,
			);
			scheduleAnchorRestoration();
			scheduleRangeEffects();
		},
		resolveLayoutMeasurement,
		onObservedWidthChange: (width) => {
			if (width <= 0) {
				widthWasZero = true;
				pendingLayoutAnchor = null;
			}
		},
		frameCoordinator,
	});
	const measurement = virtualList.measurement;

	function getMountedRows(): readonly MountedTwoHopRow[] {
		return virtualList.getMountedBuild()?.rowsInMountedRange ?? EMPTY_MOUNTED_ROWS;
	}

	function syncMountedInteractions(
		rows: readonly MountedTwoHopRow[] = getMountedRows(),
	): void {
		if (disposed) return;
		interactionController.syncCards(
			buildTwoHopInteractionBindings(rows, cardHydrator.getModel),
		);
		interactionBindingRevision += 1;
	}

	function getInteractionHandle(physicalCellSlot: number): InteractionHandle {
		void interactionBindingRevision;
		return interactionController.getInteractionHandle(String(physicalCellSlot));
	}

	function publishPreviewSnapshot(): void {
		if (disposed) return;
		const active = isPreviewSurfaceActive();
		previewSurface.publish({
			bindings: buildTwoHopPreviewBindings(
				getMountedRows(),
				cardHydrator.getModel,
				layout.cellWidth,
				layout.rowHeight,
				active,
			),
			visibleRange: previewVisibleRange,
			prefetchRange: previewPrefetchRange,
			active,
		});
	}

	function applyRangeEffects(): void {
		if (disposed) return;
		const snapshot = virtualList.getSnapshot();
		previewVisibleRange = snapshot?.ranges.previewVisible ?? EMPTY_RANGE;
		const active = isPreviewSurfaceActive();
		const nextPreviewPrefetchRange = previewPrefetchRangeTracker.resolve(
			previewVisibleRange,
			rowModel.rowCount,
		);
		previewPrefetchRange = active ? nextPreviewPrefetchRange : previewVisibleRange;
		cardHydrator.setDemand(
			collectTwoHopCardDemand(
				getMountedRows(),
				previewVisibleRange,
				previewPrefetchRange,
				active,
			),
		);
		publishPreviewSnapshot();
	}

	function scheduleRangeEffects(): void {
		frameCoordinator.schedule(
			"post-paint",
			RANGE_EFFECT_TASK_KEY,
			applyRangeEffects,
		);
	}

	function resolveTwoHopGridLayout(rect: DOMRect): TwoHopGridLayout {
		if (!rootEl) return layout;
		const layoutBase = resolveCardGridLayoutBase({
			rootEl,
			rootRect: rect,
			measuredWidth: rect.width > 0 ? rect.width : measurement.measuredWidth,
			defaults: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT,
			configuredLayout,
		});
		return {
			containerWidth: layoutBase.containerWidth,
			columns: layoutBase.columns,
			cellWidth: layoutBase.cellWidth,
			rowHeight: layoutBase.rowHeight,
			gap: layoutBase.gap,
			sectionMarginBottom: Math.max(
				0,
				layoutBase.cardLayout.sectionMarginBottomPx,
			),
		};
	}

	function resolveLayoutMeasurement(
		nextMeasurement: VirtualMeasurement & { readonly sectionRect: DOMRect },
	) {
		const nextLayout = resolveTwoHopGridLayout(nextMeasurement.sectionRect);
		if (!isSameTwoHopGridLayout(layout, nextLayout)) {
			if (!widthWasZero) capturePendingLayoutAnchor();
			layout = nextLayout;
			const nextRowModel = createTwoHopRowModel({
				sections: props.sections,
				layout: nextLayout,
			});
			rowModel = nextRowModel;
		}
		widthWasZero = false;
		return {
			context: rowModel,
			measurement: nextMeasurement,
			isStable: nextMeasurement.isStableMeasurement,
		};
	}

	function capturePendingLayoutAnchor(): void {
		pendingLayoutAnchor ??= captureTwoHopLayoutAnchor(
			rootEl,
			rowModel,
			measurement,
		);
	}

	function scheduleAnchorRestoration(): void {
		if (!pendingLayoutAnchor) return;
		schedulePostCommitMeasurement();
	}

	function schedulePostCommitMeasurement(): void {
		if (postCommitMeasurementScheduled) return;
		postCommitMeasurementScheduled = true;
		// The committed content height must reach the DOM before scrollTop can
		// reflect its new clamp. Coalesce intervening data and layout updates.
		void tick().then(runPostCommitMeasurement);
	}

	function runPostCommitMeasurement(): void {
		postCommitMeasurementScheduled = false;
		if (disposed) return;
		if (virtualList.getSnapshot()?.rowModel !== rowModel) {
			virtualList.scheduleLayoutMeasurement();
			return;
		}
		const anchor = pendingLayoutAnchor;
		pendingLayoutAnchor = null;
		if (anchor) {
			const delta = restoreTwoHopLayoutAnchor(anchor, rootEl, rowModel);
			if (delta !== 0) {
				virtualList.suppressNextNativeScroll(anchor.scrollTop + delta);
			}
		}
		// A shorter DOM can clamp scrolling even when no anchor can be captured.
		virtualList.runScrollMeasurement(undefined, "data-change");
	}

	function publishSections(nextSections: readonly TwoHopSectionModel[]): void {
		capturePendingLayoutAnchor();
		const nextRowModel = createTwoHopRowModel({
			sections: nextSections,
			layout,
		});
		rowModel = nextRowModel;
		schedulePostCommitMeasurement();
		if (nextRowModel.rowCount === 0) {
			virtualList.setEmpty({ rowModel: nextRowModel });
			return;
		}

		const publication = virtualList.runScrollMeasurement(undefined, "data-change");
		if (publication.kind !== "measured") {
			virtualList.scheduleLayoutMeasurement();
		}
	}

	$effect(() => {
		const nextSections = props.sections;
		if (nextSections === lastSections) return;
		lastSections = nextSections;
		untrack(() => publishSections(nextSections));
	});

	$effect(() => {
		void configuredLayout;
		virtualList.scheduleLayoutMeasurement();
	});

	$effect(() => {
		const element = rootEl;
		if (!element) return;
		return virtualList.observeRoot(element, (callback) => untrack(callback));
	});

	$effect(() => {
		const revision = props.cardModelRevision;
		if (revision === lastCardModelRevision) return;
		lastCardModelRevision = revision;
		untrack(() => cardHydrator.refreshDemand());
	});

	$effect(() => {
		void props.previewActive;
		untrack(scheduleRangeEffects);
	});

	onDestroy(() => {
		disposed = true;
		pendingLayoutAnchor = null;
		frameCoordinator.cancel("post-paint", RANGE_EFFECT_TASK_KEY);
		cardHydrator.dispose();
		interactionController.clear();
		previewSurface.dispose();
	});

	function flushVirtualScrollMeasurement(snapshot: ProgrammaticScrollSnapshot): void {
		virtualList.flushProgrammaticScrollMeasurement(snapshot);
	}

	function resolveNavigationTarget(
		currentKey: string,
		direction: NavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	) {
		return (
			rowModel.resolveNavigationTarget?.(
				currentKey,
				direction,
				currentPosition,
			) ?? null
		);
	}

	function resolveSequentialNavigationTarget(
		currentKey: string,
		direction: SequentialNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	) {
		return (
			rowModel.resolveSequentialNavigationTarget?.(
				currentKey,
				direction,
				currentPosition,
			) ?? null
		);
	}

	return {
		get rootEl() {
			return rootEl;
		},
		set rootEl(next: HTMLDivElement | null) {
			rootEl = next;
			frameCoordinator.bindOwnerElement?.(next);
		},
		get layout() {
			return layout;
		},
		get contentHeight() {
			return virtualList.getTotalHeight(rowModel.totalHeight);
		},
		get mountedRows() {
			return getMountedRows();
		},
		get scrollContainerEl() {
			return measurement.scrollContainerEl;
		},
		get previewSurface() {
			return previewSurface;
		},
		get interactionDescriptorResolverProvider() {
			return interactionController.provider;
		},
		isPreviewHostEnabled(rowIndex: number): boolean {
			const mounted = virtualList.getSnapshot()?.ranges.mounted;
			return (
				isPreviewSurfaceActive() &&
				mounted !== undefined &&
				rowIndex >= mounted.start &&
				rowIndex < mounted.end
			);
		},
		registerCardModelConsumer: cardHydrator.registerConsumer,
		getInteractionHandle,
		resolveNavigationTarget,
		resolveSequentialNavigationTarget,
		flushVirtualScrollMeasurement,
		loadMore(sectionId: string): void {
			props.loadMoreSection?.(sectionId);
		},
	};
}
