import { untrack, getContext, onDestroy, type Snippet } from "svelte";
import type {
	NavigationDirection,
	SequentialNavigationDirection,
} from "cards/navigation/types";
import type { RowRange } from "cards/virtualization/public";
import { getLazyLoadManager } from "obsidian-integration/observers/IntersectionObserverRegistry";
import {
	buildMountedFlatGridRows,
	type MountedFlatGridCell,
	type MountedFlatGridBuild,
	type MountedFlatGridRow,
} from "./mountedRows";
import type { FlatGridRowModel } from "./rowModel";
import { createFlatGridModelMemo } from "./modelMemo";
import type { VirtualListStableMeasurementContext } from "cards/virtualization/public";
import {
	createResolvedCardLayoutSettingsMemo,
	type CardLayoutSettings,
} from "cards/layout/cardLayoutCssVars";
import {
	createSectionPaginationState,
	type SectionPaginationApplicationStore,
} from "cards/grid/pagination/sectionPagination";
import { useVirtualizer } from "cards/virtualization/public";
import type { FlatGridLogicalCell } from "./logicalCell";
import type { VirtualNavigationTarget } from "cards/virtualization/public";
import {
	DEFAULT_FLAT_GRID_LAYOUT,
	isSameFlatGridLayout,
	resolveFlatGridLayoutMeasurement,
	type ConfiguredCardLayout,
	type FlatGridLayout,
} from "cards/grid/layout/flatGridMeasurement";
import { DISABLED_PREVIEW_SURFACE } from "card-preview/runtime/previewRuntime";
import type { CardPreviewRequest } from "card-preview/pipeline/cardPreviewRequest";
import type {
	InteractionHandle,
	ItemInteractionDescriptor,
} from "cards/interactions/interactionTypes";
import { createVirtualCardInteractionController } from "cards/interactions/virtualCardInteractionController";
import { useAppContext } from "cards/context/linkContext";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { DEFAULT_SETTINGS } from "settings/model";
import {
	createFlatGridCardBindingsMemo,
	isMountedFlatGridItemCell,
} from "./mountedCardBindings";
import type { FlatListScrollState } from "cards/list/model/listViewUiState";
import { createPreviewPrefetchRangeTracker } from "card-preview/prefetch/previewPrefetchRange";
import { createFlatGridInfiniteScrollController } from "./infiniteScroll";
import { createFlatGridScrollStateController } from "./scrollState";
import { createCardGridVisibilityPolicyResolver } from "cards/grid/model/cardGridVisibilityPolicy";

/** Props passed to flat virtual list item render snippets. */
export interface FlatCardGridItemRenderArgs<T> {
	item: T;
	index: number;
	scrollContainerEl: HTMLElement | null;
	rowIndex: number;
	activationCandidateId: string;
	readonly previewKey: string;
	readonly interactionHandle: InteractionHandle;
}

type FlatCardGridApplicationSettings = CardLayoutSettings;

interface FlatCardGridApplicationStore extends SectionPaginationApplicationStore {
	settings?: FlatCardGridApplicationSettings;
}

export interface FlatCardGridProps<T> {
	items?: readonly T[];
	/**
	 * Stable unique identity for one logical list item. The value must remain
	 * unchanged when the item moves to another index.
	 */
	getItemId: (item: T, index: number) => string;
	/**
	 * Change this token when items are mutated in place. Array replacement is
	 * detected automatically.
	 */
	itemsRevision?: unknown;
	/**
	 * Change this token when getItemId behavior changes without replacing the
	 * resolver function.
	 */
	itemIdRevision?: unknown;
	header?: Snippet;
	item?: Snippet<[FlatCardGridItemRenderArgs<T>]>;
	empty?: Snippet;
	initialVisibleCount?: number | undefined;
	loadMoreIncrement?: number;
	sectionId?: string;
	applicationStore?: FlatCardGridApplicationStore;
	className?: string;
	paginationMode?: "button" | "infinite-scroll";
	infiniteScrollRootMargin?: string;
	/** Scroll position restored once after the first stable layout measurement. */
	initialScrollState?: FlatListScrollState;
	/** Persists stable scroll and pagination measurements outside the grid. */
	onScrollStateChange?: (state: FlatListScrollState) => void;
	/** Resolves immutable preview input for the surface-owned slot controller. */
	resolveItemPreviewRequest?: (item: T, index: number) => CardPreviewRequest | null;
	/** Resolves the current item descriptor without card-owned effects. */
	resolveItemInteractionDescriptor?: (
		item: T,
		index: number,
	) => ItemInteractionDescriptor | null;
}

const EMPTY_MOUNTED_ROWS: readonly MountedFlatGridRow<never>[] = [];

export function useFlatCardGrid<T>(
	props: FlatCardGridProps<T>,
	frameCoordinator: VirtualFrameCoordinator,
) {
	let applicationStore = props.applicationStore;
	if (!applicationStore) {
		try {
			applicationStore =
				getContext<FlatCardGridApplicationStore>("applicationStore");
		} catch {}
	}

	const items = $derived(props.items ?? []);
	const className = $derived(props.className ?? "");
	const sectionId = $derived(props.sectionId);
	const paginationMode = $derived(props.paginationMode ?? "button");
	const infiniteScrollRootMargin = $derived(
		props.infiniteScrollRootMargin ?? "0px 0px 900px 0px",
	);
	const supportsIntersectionObserver =
		typeof window !== "undefined" && "IntersectionObserver" in window;
	const lazyLoadManager = getLazyLoadManager();
	let appContext: ReturnType<typeof useAppContext> | undefined;
	try {
		appContext = useAppContext();
	} catch {
		appContext = undefined;
	}
	const previewSurfaceOptions = {
		resolveSearchMatchOffset: appContext?.resolveSearchMatchOffset,
		frameCoordinator,
	};
	const previewSurface =
		appContext?.previewRuntime?.createSurface(previewSurfaceOptions) ??
		DISABLED_PREVIEW_SURFACE;
	const interactionController = createVirtualCardInteractionController();
	const resolveCardGridVisibilityPolicy = createCardGridVisibilityPolicyResolver();
	const resolveVisibilityPolicy = (nextLayout: FlatGridLayout) =>
		resolveCardGridVisibilityPolicy(nextLayout.rowStride);
	const initialScrollState = props.initialScrollState
		? {
				localScrollTop: props.initialScrollState.localScrollTop,
				visibleCount: props.initialScrollState.visibleCount,
			}
		: undefined;
	const initialPaginationSectionId = props.sectionId ?? "link-list";
	let sectionExpandedLimits = $state.raw<Record<string, number>>(
		initialScrollState
			? { [initialPaginationSectionId]: initialScrollState.visibleCount }
			: {},
	);
	let sectionRootEl = $state<HTMLDivElement | null>(null);
	let contentEl = $state<HTMLDivElement | null>(null);
	let interactionShadowRoot = $state<ShadowRoot | null>(null);
	let infiniteScrollSentinelEl = $state<HTMLDivElement | null>(null);
	let layout = $state.raw(DEFAULT_FLAT_GRID_LAYOUT);
	const previewPrefetchRangeTracker = createPreviewPrefetchRangeTracker();
	const resolveFlatGridCardBindings = createFlatGridCardBindingsMemo<T>();
	const resolveConfiguredCardLayout = createResolvedCardLayoutSettingsMemo();
	const configuredCardLayout = $derived.by(() =>
		resolveConfiguredCardLayout(applicationStore?.settings),
	);
	const flatPaginationSectionId = $derived(sectionId ?? "link-list");
	const itemCount = $derived.by(() => {
		void props.itemsRevision;
		return items.length;
	});
	const paginationState = createSectionPaginationState({
		getExpandedLimits: () => sectionExpandedLimits,
		setExpandedLimits: (nextExpandedLimits) => {
			sectionExpandedLimits = nextExpandedLimits;
		},
		applicationStore,
		initialVisibleCount: props.initialVisibleCount,
		loadMoreIncrement: props.loadMoreIncrement,
	});
	const visibleCount = $derived(
		paginationState.getVisibleCount(flatPaginationSectionId, itemCount),
	);
	const canLoadMore = $derived(visibleCount < itemCount);
	const shouldUseInfiniteScroll = $derived(
		paginationMode === "infinite-scroll" && supportsIntersectionObserver,
	);
	const showLoadMoreButton = $derived(canLoadMore && !shouldUseInfiniteScroll);
	const flatGridModel = createFlatGridModelMemo<T>();
	const logicalCellSource = $derived.by(() => {
		return flatGridModel.resolveLogicalCellSource({
			items,
			getItemId: props.getItemId,
			itemsRevision: props.itemsRevision,
			itemIdRevision: props.itemIdRevision,
			visibleCount,
			hasHeader: Boolean(props.header),
			showLoadMore: showLoadMoreButton,
			sectionId,
		});
	});
	const logicalCellCount = $derived(logicalCellSource.cellCount);
	const resolveFlatGridRowModel = (nextLayout: FlatGridLayout): FlatGridRowModel<T> =>
		flatGridModel.resolveRowModel({
			cellSource: logicalCellSource,
			layout: nextLayout,
		});
	const rowModel = $derived(resolveFlatGridRowModel(layout));
	const publishMountedCardBindings = (
		mountedBuild: MountedFlatGridBuild<T> | null,
		visibleRange: RowRange,
	): void => {
		const prefetchRange = previewPrefetchRangeTracker.resolve(
			visibleRange,
			rowModel.rowCount,
		);
		const bindingsResult = resolveFlatGridCardBindings({
			mountedBuild,
			previewCardDimensions: {
				widthPx: layout.cellWidth,
				heightPx: layout.rowHeight,
			},
			resolvePreviewRequest: props.resolveItemPreviewRequest,
			resolveInteractionDescriptor: props.resolveItemInteractionDescriptor,
		});
		previewSurface.publish({
			bindings: bindingsResult.bindings.previewBindings,
			visibleRange,
			prefetchRange,
			active: true,
		});
		if (bindingsResult.changed) {
			interactionController.syncCards(
				bindingsResult.bindings.interactionBindings,
			);
		}
	};
	const virtualList = useVirtualizer<
		FlatGridLogicalCell<T>,
		FlatGridRowModel<T>,
		FlatGridLayout,
		MountedFlatGridBuild<T>
	>({
		getRootEl: () => sectionRootEl,
		getContext: () => layout,
		hasRenderableContent: () => itemCount > 0,
		resolveRowModel: resolveFlatGridRowModel,
		resolveVisibilityPolicy,
		buildMountedRows: ({ rowModel, rowRange, previousBuild, rowSlotAllocator }) =>
			buildMountedFlatGridRows({
				rowModel,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			}),
		onSnapshotUpdated: (snapshot) => {
			publishMountedCardBindings(
				snapshot.mountedBuild,
				snapshot.ranges.previewVisible,
			);
		},
		resolveLayoutMeasurement: (nextMeasurement, rootEl, runtimeMeasurement) => {
			const layoutMeasurement = resolveFlatGridLayoutMeasurement({
				rootEl,
				rootRect: nextMeasurement.sectionRect,
				measuredWidth: runtimeMeasurement.measuredWidth,
				configuredLayout: configuredCardLayout,
				logicalCellCount,
				hasRenderableItems: itemCount > 0,
			});
			if (!isSameFlatGridLayout(layout, layoutMeasurement.layout)) {
				layout = layoutMeasurement.layout;
			}
			return {
				context: layoutMeasurement.layout,
				measurement: nextMeasurement,
				isStable: layoutMeasurement.hasStableLayout,
			};
		},
		onStableMeasurement: handleStableMeasurement,
		frameCoordinator,
	});
	const measurement = virtualList.measurement;
	const contentHeight = $derived(virtualList.getTotalHeight(layout.contentHeight));
	const mountedRows = $derived.by<readonly MountedFlatGridRow<T>[]>(() => {
		const rowsInMountedRange = virtualList.getMountedBuild()?.rowsInMountedRange;
		return rowsInMountedRange && rowsInMountedRange.length > 0
			? rowsInMountedRange
			: EMPTY_MOUNTED_ROWS;
	});
	const scrollStateController = createFlatGridScrollStateController({
		initialState: initialScrollState,
		getRootEl: () => sectionRootEl,
		getScrollContainerEl: () => measurement.scrollContainerEl,
		getSectionTop: () => measurement.sectionTop,
		hasStableScrollMetrics: () => measurement.hasStableScrollMetrics,
		getVisibleCount: () => visibleCount,
		publish: (state) => props.onScrollStateChange?.(state),
		suppressNextNativeScroll: virtualList.suppressNextNativeScroll,
		flushProgrammaticScrollMeasurement:
			virtualList.flushProgrammaticScrollMeasurement,
	});
	const infiniteScrollController = createFlatGridInfiniteScrollController({
		observer: lazyLoadManager,
		getRootEl: () => sectionRootEl,
		getScrollContainerEl: () => measurement.scrollContainerEl,
		getRootMargin: () => infiniteScrollRootMargin,
		getContentHeight: () => layout.contentHeight,
		getPreloadMetrics: scrollStateController.getCurrentMetrics,
		shouldLoad: () => shouldUseInfiniteScroll && canLoadMore,
		loadNextPage: () => loadNextPage(),
	});

	const scheduleLayoutMeasurementForCardLayout = (
		_nextCardLayout: ConfiguredCardLayout | null,
	): void => {
		virtualList.scheduleLayoutMeasurement();
	};

	const syncVirtualListForRenderableContent = (
		nextLogicalCellCount: number,
		nextRowModel: FlatGridRowModel<T>,
	): void => {
		if (nextLogicalCellCount === 0) {
			virtualList.setEmpty({ rowModel: nextRowModel });
			return;
		}

		const currentSnapshot = virtualList.getSnapshot();
		if (currentSnapshot?.rowModel === nextRowModel) {
			return;
		}

		if (currentSnapshot) {
			virtualList.recompute({ rowModel: nextRowModel });
		}

		virtualList.scheduleLayoutMeasurement();
	};

	const observeRootElement = (): (() => void) | undefined => {
		if (!sectionRootEl || typeof window === "undefined") {
			return;
		}

		return virtualList.observeRoot(sectionRootEl, (callback) => {
			untrack(callback);
		});
	};

	const observeInfiniteScrollWhenReady = (): (() => void) | undefined => {
		if (!shouldUseInfiniteScroll || !canLoadMore || !infiniteScrollSentinelEl) {
			return;
		}

		return infiniteScrollController.observe(infiniteScrollSentinelEl);
	};

	$effect(() => {
		scheduleLayoutMeasurementForCardLayout(configuredCardLayout);
	});

	$effect(() => {
		return observeRootElement();
	});

	$effect(() => {
		syncVirtualListForRenderableContent(logicalCellCount, rowModel);
	});

	$effect(() => {
		void props.resolveItemPreviewRequest;
		void props.resolveItemInteractionDescriptor;
		const snapshot = virtualList.getSnapshot();
		if (!snapshot) return;
		publishMountedCardBindings(
			virtualList.getMountedBuild(),
			snapshot.ranges.previewVisible,
		);
	});

	onDestroy(() => {
		scrollStateController.persist();
		previewSurface.dispose();
		interactionController.clear();
	});

	const loadNextPage = () => {
		if (!canLoadMore) {
			return;
		}

		paginationState.loadMore(flatPaginationSectionId, itemCount);
	};

	function handleStableMeasurement(
		context: VirtualListStableMeasurementContext,
	): void {
		if (scrollStateController.restorePending(context)) return;

		if (!context.isScrollActive) {
			scrollStateController.publishCurrent(context);
		}
		infiniteScrollController.considerLoading(context);
	}

	$effect(() => {
		return observeInfiniteScrollWhenReady();
	});

	const resolveNavigationTarget = (
		currentKey: string,
		direction: NavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	): VirtualNavigationTarget | null =>
		rowModel.resolveNavigationTarget?.(currentKey, direction, currentPosition) ??
		null;

	const resolveSequentialNavigationTarget = (
		currentKey: string,
		direction: SequentialNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	) =>
		rowModel.resolveSequentialNavigationTarget?.(
			currentKey,
			direction,
			currentPosition,
		) ?? null;

	const createItemRenderArgs = (
		mountedCell: MountedFlatGridCell<T> | null | undefined,
		scrollContainerEl: HTMLElement | null,
	): FlatCardGridItemRenderArgs<T> | null => {
		if (!isMountedFlatGridItemCell(mountedCell)) return null;
		return {
			item: mountedCell.cell.item,
			index: mountedCell.cell.itemIndex,
			scrollContainerEl,
			rowIndex: mountedCell.rowIndex,
			activationCandidateId: mountedCell.key,
			previewKey: String(mountedCell.key),
			interactionHandle: interactionController.getInteractionHandle(
				String(mountedCell.physicalCellSlot),
			),
		};
	};

	return {
		get sectionRootEl() {
			return sectionRootEl;
		},
		set sectionRootEl(nextRootEl: HTMLDivElement | null) {
			sectionRootEl = nextRootEl;
			frameCoordinator.bindOwnerElement?.(nextRootEl);
		},
		get contentEl() {
			return contentEl;
		},
		set contentEl(nextContentEl: HTMLDivElement | null) {
			contentEl = nextContentEl;
		},
		get interactionShadowRoot() {
			return interactionShadowRoot;
		},
		set interactionShadowRoot(nextShadowRoot: ShadowRoot | null) {
			interactionShadowRoot = nextShadowRoot;
		},
		get infiniteScrollSentinelEl() {
			return infiniteScrollSentinelEl;
		},
		set infiniteScrollSentinelEl(nextSentinelEl: HTMLDivElement | null) {
			infiniteScrollSentinelEl = nextSentinelEl;
		},
		get className() {
			return className;
		},
		get itemCount() {
			return itemCount;
		},
		get contentHeight() {
			return contentHeight;
		},
		get layout() {
			return layout;
		},
		get mountedRows() {
			return mountedRows;
		},
		get slotBindingRevision() {
			return virtualList.getMountedBuild()?.slotBindingRevision;
		},
		get scrollContainerEl() {
			return measurement.scrollContainerEl;
		},
		get interactionDescriptorResolverProvider() {
			return interactionController.provider;
		},
		get previewSurface() {
			return previewSurface;
		},
		get shouldUseInfiniteScroll() {
			return shouldUseInfiniteScroll;
		},
		get canLoadMore() {
			return canLoadMore;
		},
		resolveNavigationTarget,
		resolveSequentialNavigationTarget,
		flushVirtualScrollMeasurement: virtualList.flushProgrammaticScrollMeasurement,
		createItemRenderArgs,
		loadNextPage,
	};
}
