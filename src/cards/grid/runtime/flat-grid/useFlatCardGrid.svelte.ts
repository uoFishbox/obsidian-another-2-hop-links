import { tick, untrack, getContext, onDestroy, type Snippet } from "svelte";
import type { ResultNavigationDirection } from "cards/navigation/resultFocus";
import type { RowRange, VirtualVisibilityPolicy } from "cards/virtualization/public";
import {
	getLazyLoadManager,
	type RegistrationToken,
} from "obsidian-integration/observers/IntersectionObserverRegistry";
import {
	buildMountedFlatGridCells,
	type MountedFlatGridCell,
	type MountedFlatGridBuild,
	type MountedFlatGridRow,
} from "./mountedCells";
import type { FlatGridRowModel } from "./rowModel";
import { createFlatGridModelMemo } from "./modelMemo";
import type { VirtualListStableMeasurementContext } from "cards/virtualization/public";
import {
	createResolvedCardLayoutSettingsMemo,
	type CardLayoutSettings,
} from "cards/layout/cardLayoutCssVars";
import { getOptionalOwnerWindow } from "shared/ui/dom/realmSafeDom";
import { scheduleAnimationFrame } from "shared/ui/scheduling/frame";
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
import { DISABLED_PREVIEW_SURFACE } from "preview/runtime/previewRuntime";
import type { CardPreviewRequest } from "preview/pipeline/cardPreviewRequest";
import type { ItemInteractionDescriptor } from "cards/interactions/interactionTypes";
import { createVirtualCardInteractionController } from "cards/interactions/virtualCardInteractionController";
import { useAppContext } from "cards/context/linkContext";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { DEFAULT_SETTINGS } from "settings/model";
import {
	buildCardGridBindings,
	isCardGridMountedItemCell,
} from "./mountedCardBindings";
import type { FlatListScrollState } from "cards/list/model/listViewUiState";

/** Props passed to flat virtual list item render snippets. */
export interface FlatCardGridItemRenderArgs<T> {
	item: T;
	index: number;
	scrollContainerEl: HTMLElement | null;
	rowIndex: number;
	activationCandidateId: string;
	readonly previewKey: string;
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

const MAX_CHAINED_INFINITE_SCROLL_LOADS = 2;
export const CARD_GRID_BOOTSTRAP_VISIBLE_ROWS = 3;
const CARD_GRID_PREVIEW_ACTIVATION_AHEAD_ROWS = 2;
const EMPTY_MOUNTED_ROWS: readonly MountedFlatGridRow<never>[] = [];

export function createCardGridVisibilityPolicy(
	layout: Pick<FlatGridLayout, "rowHeight" | "gap">,
): VirtualVisibilityPolicy {
	const rowOverscanPx = Math.max(0, layout.rowHeight + layout.gap);
	const previewOverscanPx = rowOverscanPx * CARD_GRID_PREVIEW_ACTIVATION_AHEAD_ROWS;
	return {
		bootstrapRows: CARD_GRID_BOOTSTRAP_VISIBLE_ROWS,
		mountedOverscanPx: Math.max(rowOverscanPx, previewOverscanPx),
		previewOverscanPx,
	};
}

interface ContentBottomPreloadMetrics {
	contentHeight: number;
	rootMargin: string;
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
}

function parseBottomRootMarginPx(rootMargin: string): number {
	const tokens = rootMargin.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return 0;
	const parsed = Number.parseFloat(tokens[tokens.length <= 2 ? 0 : 2] ?? "0");
	return Number.isFinite(parsed) ? parsed : 0;
}

export function isContentBottomInPreloadRangeFromMetrics({
	contentHeight,
	rootMargin,
	scrollTop,
	viewportHeight,
	sectionTop,
}: ContentBottomPreloadMetrics): boolean {
	const preloadBottom =
		scrollTop + viewportHeight + parseBottomRootMarginPx(rootMargin);
	return sectionTop + contentHeight <= preloadBottom;
}

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
		resolveSearchMatchPosition: appContext?.resolveSearchMatchPosition,
		frameCoordinator,
	};
	const previewSurface =
		appContext?.previewRuntime?.createSurface(previewSurfaceOptions) ??
		DISABLED_PREVIEW_SURFACE;
	const interactionController = createVirtualCardInteractionController();
	let lastResolvedVisibilityPolicyRowHeight: number | undefined;
	let lastResolvedVisibilityPolicyGap: number | undefined;
	let lastResolvedVisibilityPolicy:
		| ReturnType<typeof createCardGridVisibilityPolicy>
		| undefined;
	const resolveVisibilityPolicy = (
		nextLayout: FlatGridLayout,
	): ReturnType<typeof createCardGridVisibilityPolicy> => {
		if (
			!lastResolvedVisibilityPolicy ||
			lastResolvedVisibilityPolicyRowHeight !== nextLayout.rowHeight ||
			lastResolvedVisibilityPolicyGap !== nextLayout.gap
		) {
			lastResolvedVisibilityPolicyRowHeight = nextLayout.rowHeight;
			lastResolvedVisibilityPolicyGap = nextLayout.gap;
			lastResolvedVisibilityPolicy = createCardGridVisibilityPolicy(nextLayout);
		}
		return lastResolvedVisibilityPolicy!;
	};
	const initialScrollState = props.initialScrollState
		? {
				localScrollTop: props.initialScrollState.localScrollTop,
				visibleCount: props.initialScrollState.visibleCount,
			}
		: undefined;
	const initialPaginationSectionId = props.sectionId ?? "link-list";
	let pendingScrollRestore = initialScrollState;
	let sectionExpandedLimits = $state.raw<Record<string, number>>(
		initialScrollState
			? { [initialPaginationSectionId]: initialScrollState.visibleCount }
			: {},
	);
	let sectionRootEl = $state<HTMLDivElement | null>(null);
	let contentEl = $state<HTMLDivElement | null>(null);
	let interactionShadowRoot = $state<ShadowRoot | null>(null);
	let infiniteScrollSentinelEl = $state<HTMLDivElement | null>(null);
	let loadScheduled = $state(false);
	let chainedInfiniteScrollLoads = $state(0);
	let layout = $state.raw(DEFAULT_FLAT_GRID_LAYOUT);
	let previewPriorityRange: RowRange | undefined;
	const previewPriorityRangeScratch = { start: 0, end: 0 };
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
	const syncCardSlots = (
		rows: readonly MountedFlatGridRow<T>[],
		previewRange: RowRange,
		includeInteractions = true,
	): void => {
		const bindings = buildCardGridBindings({
			rows,
			previewRange,
			resolvePreviewRequest: props.resolveItemPreviewRequest,
			resolveInteractionDescriptor: includeInteractions
				? props.resolveItemInteractionDescriptor
				: undefined,
		});
		previewSurface.publish({
			bindings: bindings.previewBindings,
			activeRange: bindings.previewRange,
			priorityRange: previewPriorityRange,
			active: true,
		});
		if (includeInteractions) {
			interactionController.syncCards(bindings.interactionBindings);
		}
	};

	const updatePreviewPriorityRange = (
		context: VirtualListStableMeasurementContext,
	): boolean => {
		rowModel.findVisibleRangeInto(previewPriorityRangeScratch, {
			scrollTop: context.scrollTop - context.sectionTop,
			viewportHeight: context.viewportHeight,
			overscanPx: 0,
		});
		if (
			previewPriorityRange?.start === previewPriorityRangeScratch.start &&
			previewPriorityRange.end === previewPriorityRangeScratch.end
		) {
			return false;
		}

		previewPriorityRange = {
			start: previewPriorityRangeScratch.start,
			end: previewPriorityRangeScratch.end,
		};
		return true;
	};
	const virtualList = useVirtualizer<
		FlatGridLogicalCell<T>,
		FlatGridRowModel<T>,
		FlatGridLayout,
		MountedFlatGridCell<T>,
		MountedFlatGridBuild<T>
	>({
		getRootEl: () => sectionRootEl,
		getContext: () => layout,
		hasRenderableContent: () => itemCount > 0,
		resolveRowModel: resolveFlatGridRowModel,
		resolveVisibilityPolicy,
		buildMountedCells: ({ rowModel, rowRange, previousBuild, rowSlotAllocator }) =>
			buildMountedFlatGridCells({
				rowModel,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			}),
		onSnapshotUpdated: (snapshot) => {
			syncCardSlots(
				snapshot.mountedBuild?.rowsInMountedRange ?? EMPTY_MOUNTED_ROWS,
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
	const mountedCells = $derived<readonly MountedFlatGridCell<T>[]>(
		virtualList.getMountedCells(),
	);
	const mountedRows = $derived.by<readonly MountedFlatGridRow<T>[]>(() => {
		const rowsByPhysicalSlot = virtualList.getMountedBuild()?.rowsByPhysicalSlot;
		return rowsByPhysicalSlot && rowsByPhysicalSlot.length > 0
			? rowsByPhysicalSlot
			: EMPTY_MOUNTED_ROWS;
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

	const observeInfiniteScrollSentinel = (
		sentinelEl: HTMLDivElement,
	): (() => void) => {
		const token: RegistrationToken = lazyLoadManager.observe(
			sentinelEl,
			() => {
				chainedInfiniteScrollLoads = 0;
				scheduleLoadNextPage();
			},
			{
				rootMargin: infiniteScrollRootMargin,
				threshold: 0,
				root: measurement.scrollContainerEl,
			},
			false,
		);

		return () => {
			lazyLoadManager.unobserve(token);
		};
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

		return observeInfiniteScrollSentinel(infiniteScrollSentinelEl);
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
		const rows =
			virtualList.getMountedBuild()?.rowsInMountedRange ?? EMPTY_MOUNTED_ROWS;
		syncCardSlots(rows, snapshot.ranges.previewVisible);
	});

	onDestroy(() => {
		persistCurrentScrollState();
		previewSurface.dispose();
		interactionController.clear();
	});

	const loadNextPage = () => {
		if (!canLoadMore) {
			return;
		}

		paginationState.loadMore(flatPaginationSectionId, itemCount);
	};

	const scheduleLoadNextPage = () => {
		if (loadScheduled) {
			return;
		}

		loadScheduled = true;
		scheduleAnimationFrame(async () => {
			loadScheduled = false;
			loadNextPage();

			await tick();

			if (!sectionRootEl || !shouldUseInfiniteScroll || !canLoadMore) {
				return;
			}

			const preloadMetrics = getCurrentPreloadMetrics();
			if (
				chainedInfiniteScrollLoads < MAX_CHAINED_INFINITE_SCROLL_LOADS &&
				preloadMetrics &&
				isContentBottomInPreloadRangeFromMetrics({
					contentHeight: layout.contentHeight,
					rootMargin: infiniteScrollRootMargin,
					...preloadMetrics,
				})
			) {
				chainedInfiniteScrollLoads += 1;
				scheduleLoadNextPage();
			}
		}, sectionRootEl?.ownerDocument.defaultView);
	};

	function getCurrentPreloadMetrics(): VirtualListStableMeasurementContext | null {
		const root = measurement.scrollContainerEl;
		const ownerWindow = getOptionalOwnerWindow(root ?? sectionRootEl);
		if (!ownerWindow) {
			return null;
		}

		return {
			scrollTop: root
				? root.scrollTop
				: ownerWindow.scrollY || ownerWindow.pageYOffset || 0,
			viewportHeight: root ? root.clientHeight : ownerWindow.innerHeight,
			sectionTop: measurement.sectionTop,
			isScrollActive: false,
		};
	}

	function maybeScheduleInfiniteScrollLoad(
		context?: VirtualListStableMeasurementContext,
	): void {
		if (!sectionRootEl || !shouldUseInfiniteScroll || !canLoadMore) {
			return;
		}

		const preloadMetrics = context ?? getCurrentPreloadMetrics();
		if (
			!preloadMetrics ||
			!isContentBottomInPreloadRangeFromMetrics({
				contentHeight: layout.contentHeight,
				rootMargin: infiniteScrollRootMargin,
				scrollTop: preloadMetrics.scrollTop,
				viewportHeight: preloadMetrics.viewportHeight,
				sectionTop: preloadMetrics.sectionTop,
			})
		) {
			return;
		}

		chainedInfiniteScrollLoads = 0;
		scheduleLoadNextPage();
	}

	function handleStableMeasurement(
		context: VirtualListStableMeasurementContext,
	): void {
		if (updatePreviewPriorityRange(context)) {
			const snapshot = virtualList.getSnapshot();
			if (snapshot) {
				syncCardSlots(
					snapshot.mountedBuild?.rowsInMountedRange ?? EMPTY_MOUNTED_ROWS,
					snapshot.ranges.previewVisible,
					false,
				);
			}
		}

		if (restorePendingScrollPosition(context)) {
			return;
		}

		publishScrollState(context);
		maybeScheduleInfiniteScrollLoad(context);
	}

	function restorePendingScrollPosition(
		context: VirtualListStableMeasurementContext,
	): boolean {
		const restoreState = pendingScrollRestore;
		if (!restoreState) return false;

		const scrollContainerEl = measurement.scrollContainerEl;
		const ownerWindow = getOptionalOwnerWindow(scrollContainerEl ?? sectionRootEl);
		if (!ownerWindow) return false;

		pendingScrollRestore = undefined;
		const targetScrollTop = Math.max(
			0,
			context.sectionTop + restoreState.localScrollTop,
		);
		if (scrollContainerEl) {
			scrollContainerEl.scrollTop = targetScrollTop;
		} else {
			ownerWindow.scrollTo({ top: targetScrollTop });
		}

		const restoredScrollTop = scrollContainerEl
			? scrollContainerEl.scrollTop
			: ownerWindow.scrollY || ownerWindow.pageYOffset || 0;
		if (restoredScrollTop !== context.scrollTop) {
			virtualList.suppressNextNativeScroll(restoredScrollTop);
		}
		virtualList.flushProgrammaticScrollMeasurement(
			{
				scrollContainerEl,
				scrollTop: restoredScrollTop,
				viewportHeight: scrollContainerEl
					? scrollContainerEl.clientHeight
					: ownerWindow.innerHeight,
				sectionTop: context.sectionTop,
				didScroll: restoredScrollTop !== context.scrollTop,
			},
			{ forcePublish: true },
		);
		return true;
	}

	function publishScrollState(context: VirtualListStableMeasurementContext): void {
		props.onScrollStateChange?.({
			localScrollTop: Math.max(0, context.scrollTop - context.sectionTop),
			visibleCount,
		});
	}

	function persistCurrentScrollState(): void {
		if (pendingScrollRestore || !measurement.hasStableScrollMetrics) return;
		const context = getCurrentPreloadMetrics();
		if (context) publishScrollState(context);
	}

	$effect(() => {
		return observeInfiniteScrollWhenReady();
	});

	const resolveNavigationTarget = (
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	): VirtualNavigationTarget | null =>
		rowModel.resolveNavigationTarget?.(currentKey, direction, currentPosition) ??
		null;

	const createItemRenderArgs = (
		mountedCell: MountedFlatGridCell<T> | null | undefined,
		scrollContainerEl: HTMLElement | null,
	): FlatCardGridItemRenderArgs<T> | null => {
		if (!isCardGridMountedItemCell(mountedCell)) return null;
		return {
			item: mountedCell.cell.item,
			index: mountedCell.cell.itemIndex,
			scrollContainerEl,
			rowIndex: mountedCell.rowIndex,
			activationCandidateId: mountedCell.key,
			previewKey: String(mountedCell.key),
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
		get mountedCells() {
			return mountedCells;
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
		flushVirtualScrollMeasurement: virtualList.flushProgrammaticScrollMeasurement,
		createItemRenderArgs,
		loadNextPage,
	};
}
