import { tick, untrack, getContext, type Snippet } from "svelte";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	getLazyLoadManager,
	type RegistrationToken,
} from "infrastructure/observers/IntersectionObserverRegistry";
import { computeVirtualGridLayout } from "../../virtualGridLinkListLayout";
import type { RowRange } from "../rowRange";
import {
	buildMountedVirtualGridCellsFromRowModel,
	type MountedVirtualGridCell,
	type MountedVirtualGridCellsBuildResult,
	type MountedVirtualGridRowSlice,
} from "../reconciliation/linkListVirtualLayout";
import type { FlatLinkRowModel } from "../row-models/flatLinkRowModel";
import { createFlatVirtualGridRuntimeModel } from "../row-models/flatVirtualGridRuntimeModel";
import { isContentBottomInPreloadRangeFromMetrics } from "../../virtualGridLinkListScroll";
import type { MeasurementUpdateResult } from "../dom/virtualListMeasurementAdapter";
import {
	createVirtualListController,
	type VirtualListStableMeasurementContext,
} from "../dom/virtualListController";
import { createVirtualListMeasurementState } from "../dom/virtualListMeasurementState";
import { resolveVirtualListLayoutStability } from "../dom/virtualListMeasurementStability";
import { resolveCachedCardGridLayoutBase } from "../dom/virtualListCardLayout";
import {
	CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES,
	createCardVirtualListPolicy,
} from "../cardVirtualListPolicy";
import { resolveCardLayoutSettings } from "ui/utils/cardLayoutCssVars";
import { getOptionalOwnerWindow } from "ui/utils/realmSafeDom";
import { scheduleAnimationFrame } from "ui/utils/frame";
import { createSectionPaginationState } from "../pagination";
import { useVirtualList } from "./useVirtualList.svelte";
import type { VirtualListLogicalCell } from "../logicalCell";
import type {
	VirtualizedItemVisibility,
	VirtualizedItemVisibilityState,
} from "../../virtualizedItemVisibility";
import {
	createVirtualizedItemVisibilityStateController,
	resolveVirtualizedItemVisibilityForPreviewRange,
} from "./virtualizedItemVisibilityState.svelte";
import type { RenderRevision, RenderRevisionFallbackPolicy } from "../renderRevision";
import type { VirtualNavigationTarget, VirtualRanges } from "../types";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";

export interface FlatVirtualGridListProps<T> {
	items?: readonly T[];
	getKey: (item: T, index: number) => string;
	/**
	 * Change this token when items are mutated in place. Array replacement is
	 * detected automatically.
	 */
	itemsRevision?: unknown;
	/**
	 * Change this token when getKey behavior changes without replacing the
	 * resolver function.
	 */
	keyRevision?: unknown;
	itemRenderRevisionToken?: RenderRevision;
	getItemRenderRevision?: (item: T, index: number) => RenderRevision | undefined;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
	header?: Snippet;
	item?: Snippet<
		[
			{
				item: T;
				index: number;
				observerRoot: HTMLElement | null;
				visibility: VirtualizedItemVisibility;
				visibilityState: VirtualizedItemVisibilityState;
				rowIndex: number;
				activationCandidateId: string;
			},
		]
	>;
	empty?: Snippet;
	initialVisibleCount?: number | undefined;
	loadMoreIncrement?: number;
	sectionId?: string;
	applicationStore?: ApplicationStore;
	className?: string;
	paginationMode?: "button" | "infinite-scroll";
	infiniteScrollRootMargin?: string;
	onMountedCellsChange?: (cells: readonly MountedVirtualGridCell<T>[]) => void;
}

const MAX_CHAINED_INFINITE_SCROLL_LOADS = 2;
const EMPTY_MOUNTED_ROWS: readonly MountedVirtualGridRowSlice<never>[] = [];
const DEFAULT_CARD_LAYOUT = resolveCardLayoutSettings();
const DEFAULT_LAYOUT = computeVirtualGridLayout({
	containerWidth: DEFAULT_CARD_LAYOUT.cardWidthPx,
	minCellWidth: DEFAULT_CARD_LAYOUT.cardWidthPx,
	gap: DEFAULT_CARD_LAYOUT.cardGapPx,
	maxColumns: DEFAULT_CARD_LAYOUT.cardMaxColumns,
	rowHeight: DEFAULT_CARD_LAYOUT.cardHeightPx,
	cellCount: 0,
});
type VirtualGridLayout = typeof DEFAULT_LAYOUT;
type ConfiguredCardLayout = ReturnType<typeof resolveCardLayoutSettings>;
type FlatMountedItemCell<T> = MountedVirtualGridCell<T> & {
	readonly cell: Extract<VirtualListLogicalCell<T>, { kind: "item" }>;
};

const isSameLayout = (current: VirtualGridLayout, next: VirtualGridLayout): boolean =>
	current.containerWidth === next.containerWidth &&
	current.columns === next.columns &&
	current.cellWidth === next.cellWidth &&
	current.gap === next.gap &&
	current.rowHeight === next.rowHeight &&
	current.rowCount === next.rowCount &&
	current.rowStride === next.rowStride &&
	current.contentHeight === next.contentHeight;

export function useFlatVirtualGridList<T>(props: FlatVirtualGridListProps<T>) {
	let applicationStore = props.applicationStore;
	if (!applicationStore) {
		try {
			applicationStore = getContext<ApplicationStore>("applicationStore");
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
	const rowPreviewActivationRuntime = getContext<
		RowPreviewActivationRuntime | undefined
	>(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY);
	const visibilityStates = createVirtualizedItemVisibilityStateController<
		MountedVirtualGridCell<T>
	>({
		onRowVisibilityChanged: (rowIndex, visibility) => {
			rowPreviewActivationRuntime?.setRowVisibility(rowIndex, visibility);
		},
		onRowCleared: (rowIndex) => {
			rowPreviewActivationRuntime?.clearRow(rowIndex);
		},
	});
	let visibilityMountedRows: readonly MountedVirtualGridRowSlice<T>[] | readonly [] =
		EMPTY_MOUNTED_ROWS;
	let visibilityMountedRange: RowRange = { start: 0, end: 0 };
	let visibilityRowModel: object | null = null;
	let visibilityPreviewRange: RowRange | null = null;
	const reusableRowSlotsScratch: number[] = [];
	const syncVisibilityStates = (
		mountedRows: readonly MountedVirtualGridRowSlice<T>[] | readonly [],
		nextMountedRange: RowRange,
		nextPreviewRange: RowRange,
		nextRowModel: object,
	): void => {
		if (!visibilityPreviewRange || nextRowModel !== visibilityRowModel) {
			visibilityStates.syncMountedRows({
				mountedRows,
				previewRange: nextPreviewRange,
			});
		} else if (mountedRows !== visibilityMountedRows) {
			visibilityStates.syncMountedRowRangeDelta({
				previousRows: visibilityMountedRows,
				nextRows: mountedRows,
				previousRowRange: visibilityMountedRange,
				nextRowRange: nextMountedRange,
				previewRange: nextPreviewRange,
			});
		} else {
			visibilityStates.syncPreviewRangeDelta({
				previousPreviewRange: visibilityPreviewRange,
				nextPreviewRange,
				mountedRows,
			});
		}

		visibilityMountedRows = mountedRows;
		visibilityMountedRange = nextMountedRange;
		visibilityRowModel = nextRowModel;
		visibilityPreviewRange = nextPreviewRange;
	};

	let sectionExpandedLimits = $state.raw<Record<string, number>>({});
	let sectionRootEl = $state<HTMLDivElement | null>(null);
	let contentEl = $state<HTMLDivElement | null>(null);
	let interactionShadowRoot = $state<ShadowRoot | null>(null);
	let infiniteScrollSentinelEl = $state<HTMLDivElement | null>(null);
	let measurement = $state(createVirtualListMeasurementState());
	let loadScheduled = $state(false);
	let chainedInfiniteScrollLoads = $state(0);
	let layout = $state.raw(DEFAULT_LAYOUT);
	const configuredCardLayout = $derived.by(() =>
		applicationStore?.settings
			? resolveCardLayoutSettings(applicationStore.settings)
			: null,
	);
	const previewActivationAheadRows = $derived(
		applicationStore?.settings?.previewActivationAheadRows ?? 1,
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
	const flatGridModel = createFlatVirtualGridRuntimeModel<T>();
	const dataSource = $derived(
		flatGridModel.createDataSource({
			items,
			getKey: props.getKey,
			itemsRevision: props.itemsRevision,
			keyRevision: props.keyRevision,
			itemRenderRevisionToken: props.itemRenderRevisionToken,
			getItemRenderRevision: props.getItemRenderRevision,
		}),
	);
	const logicalCellSource = $derived.by(() => {
		return flatGridModel.resolveLogicalCellSource({
			dataSource,
			visibleCount,
			hasHeader: Boolean(props.header),
			showLoadMore: showLoadMoreButton,
			sectionId,
		});
	});
	const logicalCellCount = $derived(logicalCellSource.cellCount);
	const resolveFlatLinkRowModel = (
		nextLayout: VirtualGridLayout,
	): FlatLinkRowModel<T> =>
		flatGridModel.resolveRowModel({
			cellSource: logicalCellSource,
			layout: nextLayout,
		});
	const rowModel = $derived(resolveFlatLinkRowModel(layout));
	const virtualList = useVirtualList<
		VirtualListLogicalCell<T>,
		FlatLinkRowModel<T>,
		MountedVirtualGridCell<T>,
		MountedVirtualGridCellsBuildResult<T>
	>({
		buildMountedCells: ({
			rowModel,
			rowRange,
			previousBuild,
			previousCellsByKey,
		}) =>
			buildMountedVirtualGridCellsFromRowModel({
				rowModel,
				rowRange,
				previousBuild,
				previousCellsByKey,
				renderRevisionFallbackPolicy: props.renderRevisionFallbackPolicy,
				reusableRowSlotsScratch,
			}),
		onStableVisibleRange: () => {
			measurement.hasStableVisibleRange = true;
		},
		visibilityMetadataPolicy: { type: "caller-managed" },
		onSnapshotUpdated: (snapshot, reconciliationState) => {
			syncVisibilityStates(
				reconciliationState.mountedBuild?.rowSlices ?? EMPTY_MOUNTED_ROWS,
				snapshot.ranges.mounted,
				snapshot.ranges.previewVisible,
				snapshot.rowModel,
			);
		},
	});
	const virtualListSnapshot = $derived(virtualList.getSnapshot());
	const contentHeight = $derived(virtualList.getTotalHeight(layout.contentHeight));
	const mountedCells = $derived<readonly MountedVirtualGridCell<T>[]>(
		virtualList.getMountedCells(),
	);
	const mountedRows = $derived.by<readonly MountedVirtualGridRowSlice<T>[]>(() => {
		const rowSlices = virtualList.getReconciliationState().mountedBuild?.rowSlices;
		return rowSlices && rowSlices.length > 0 ? rowSlices : EMPTY_MOUNTED_ROWS;
	});
	const mountedCellsForChange = $derived<readonly MountedVirtualGridCell<T>[]>(
		virtualList.getMountedCellsForChange(),
	);
	let lastEmptyMountedCellsNotification: unknown = null;
	const updateVirtualRangesFromMeasurement = (
		scrollTop: number,
		viewportHeight: number,
		sectionTop: number,
		isStableMeasurement: boolean,
		isScrollActive: boolean,
		nextLayout = layout,
		precomputedRanges?: VirtualRanges,
	): MeasurementUpdateResult<RowRange> => {
		const measurementRowModel = resolveFlatLinkRowModel(nextLayout);
		return virtualList.applyMeasurement({
			rowModel: measurementRowModel,
			scrollTop,
			viewportHeight,
			sectionTop,
			isStableMeasurement,
			isScrollActive,
			hasStableVisibleRange: measurement.hasStableVisibleRange,
			precomputedRanges,
			visibilityPolicy: createCardVirtualListPolicy({
				layout: nextLayout,
				previewActivationAheadRows,
			}),
		});
	};

	const virtualListController = createVirtualListController({
		getRootEl: () => sectionRootEl,
		measurement,
		getLayout: () => layout,
		setLayout: (nextLayout) => {
			layout = nextLayout;
		},
		isSameLayout,
		resolveLayoutMeasurement: (rootEl, rootRect) => {
			const layoutBase = resolveCachedCardGridLayoutBase({
				rootEl,
				rootRect,
				measuredWidth: measurement.measuredWidth,
				defaults: DEFAULT_CARD_LAYOUT,
				listKind: "flat",
				scrollContainerEl: measurement.scrollContainerEl,
				configuredLayout: configuredCardLayout,
				includeSectionMarginBottom: false,
			});
			const nextLayout = computeVirtualGridLayout({
				containerWidth: layoutBase.containerWidth,
				minCellWidth: layoutBase.cardLayout.cardWidthPx,
				gap: layoutBase.gap,
				maxColumns: layoutBase.columns,
				rowHeight: layoutBase.rowHeight,
				cellCount: logicalCellCount,
			});
			const hasRenderableItems = itemCount > 0;
			const layoutStability = resolveVirtualListLayoutStability({
				rootEl,
				rootRect,
				measuredWidth: measurement.measuredWidth,
				hasRenderableContent: hasRenderableItems,
			});

			return {
				layout: nextLayout,
				content: logicalCellSource,
				hasRenderableContent: hasRenderableItems,
				hasStableLayout: layoutStability.isStable,
			};
		},
		getCachedContent: () => logicalCellSource,
		hasRenderableContent: () => itemCount > 0,
		applyRangeMeasurement: ({
			scrollTop,
			viewportHeight,
			sectionTop,
			isStableMeasurement,
			isScrollActive,
			layout: nextLayout,
			precomputedRanges,
		}) =>
			updateVirtualRangesFromMeasurement(
				scrollTop,
				viewportHeight,
				sectionTop,
				isStableMeasurement,
				isScrollActive,
				nextLayout,
				precomputedRanges,
			),
		resolveScrollWindowMeasurement: (
			scrollTop,
			viewportHeight,
			sectionTop,
			_content,
			nextLayout,
		) => {
			const measurementRowModel = resolveFlatLinkRowModel(nextLayout);
			const visibilityPolicy = createCardVirtualListPolicy({
				layout: nextLayout,
				previewActivationAheadRows,
			});
			return {
				identity: measurementRowModel,
				ranges: measurementRowModel.findVisibleRanges({
					scrollTop: scrollTop - sectionTop,
					viewportHeight,
					mountedOverscanPx: visibilityPolicy.mountedOverscanPx,
					previewOverscanPx: visibilityPolicy.previewOverscanPx,
				}),
			};
		},
		onStableLayoutMeasurement: (context) => {
			maybeScheduleInfiniteScrollLoad(context);
		},
		onStableScrollMeasurement: (context) => {
			maybeScheduleInfiniteScrollLoad(context);
		},
		maxUnstableMeasurementRetries:
			CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES,
	});

	const scheduleLayoutMeasurementForCardLayout = (
		_nextCardLayout: ConfiguredCardLayout | null,
	): void => {
		virtualListController.scheduleLayoutMeasurement();
	};

	const syncRenderableContentMeasurement = (
		nextLogicalCellCount: number,
		nextRowModel: FlatLinkRowModel<T>,
	): void => {
		if (nextLogicalCellCount === 0) {
			virtualList.setEmpty({
				rowModel: nextRowModel,
				reason: "no-renderable-content",
			});
			return;
		}

		virtualListController.scheduleLayoutMeasurement();
	};

	const notifyEmptyMountedCellsChange = (
		currentSnapshot: typeof virtualListSnapshot,
	): void => {
		if (
			currentSnapshot?.mode.kind !== "empty" ||
			lastEmptyMountedCellsNotification === currentSnapshot
		) {
			return;
		}

		lastEmptyMountedCellsNotification = currentSnapshot;
		untrack(() => props.onMountedCellsChange?.([]));
	};

	const recomputeVirtualListForRowModel = (
		nextLogicalCellCount: number,
		nextRowModel: FlatLinkRowModel<T>,
	): void => {
		if (nextLogicalCellCount === 0) {
			virtualList.setEmpty({
				rowModel: nextRowModel,
				reason: "no-renderable-content",
			});
			return;
		}

		if (virtualList.getSnapshot()?.rowModel === nextRowModel) {
			return;
		}

		virtualList.recompute({ rowModel: nextRowModel });
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

		return virtualListController.observeRoot(sectionRootEl, (callback) => {
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
		syncRenderableContentMeasurement(logicalCellCount, rowModel);
	});

	$effect(() => {
		notifyEmptyMountedCellsChange(virtualListSnapshot);
	});

	$effect(() => {
		recomputeVirtualListForRowModel(logicalCellCount, rowModel);
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
		});
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

	$effect(() => {
		return observeInfiniteScrollWhenReady();
	});

	const flushVirtualScrollMeasurement = (
		scrollContainerEl: HTMLElement | null,
		targetTop: number,
	): void => {
		if (measurement.scrollContainerEl !== scrollContainerEl) {
			measurement.scrollContainerEl = scrollContainerEl;
		}
		if (scrollContainerEl && scrollContainerEl.clientHeight > 0) {
			measurement.viewportHeight = scrollContainerEl.clientHeight;
			measurement.sectionTop = Math.max(
				0,
				scrollContainerEl.scrollTop - targetTop,
			);
			measurement.hasStableScrollMetrics = true;
		}
		virtualListController.updateFromCachedMeasurement();
	};

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
		mountedCell: MountedVirtualGridCell<T>,
		observerRoot: HTMLElement | null,
	) => {
		const itemCell = mountedCell as FlatMountedItemCell<T>;
		const visibilityState = visibilityStates.getOrCreateState(
			itemCell,
			untrack(() => {
				const previewVisible = virtualList.getSnapshot()?.ranges.previewVisible;
				return previewVisible
					? resolveVirtualizedItemVisibilityForPreviewRange(
							itemCell.rowIndex,
							previewVisible,
						)
					: "mounted";
			}),
		);

		return {
			item: itemCell.cell.item,
			index: itemCell.cell.itemIndex,
			observerRoot,
			visibilityState,
			rowIndex: itemCell.rowIndex,
			activationCandidateId: itemCell.key,
			get visibility() {
				return visibilityState.visibility;
			},
		};
	};

	return {
		get sectionRootEl() {
			return sectionRootEl;
		},
		set sectionRootEl(nextRootEl: HTMLDivElement | null) {
			sectionRootEl = nextRootEl;
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
		get mountedCellsForChange() {
			return mountedCellsForChange;
		},
		get observerRoot() {
			return measurement.scrollContainerEl;
		},
		get shouldUseInfiniteScroll() {
			return shouldUseInfiniteScroll;
		},
		get canLoadMore() {
			return canLoadMore;
		},
		getCellPosition: (mountedCell: MountedVirtualGridCell<T>) =>
			mountedCell.position,
		resolveNavigationTarget,
		flushVirtualScrollMeasurement,
		createItemRenderArgs,
		loadNextPage,
	};
}
