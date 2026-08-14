import { tick, untrack, getContext, onDestroy, type Snippet } from "svelte";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { RowRange } from "ui/virtualization/rowRange";
import {
	getLazyLoadManager,
	type RegistrationToken,
} from "infrastructure/observers/IntersectionObserverRegistry";
import {
	buildMountedVirtualGridCellsFromRowModel,
	type MountedVirtualGridCell,
	type MountedVirtualGridCellsBuildResult,
	type MountedVirtualGridRowSlice,
} from "../core/reconciliation/linkListVirtualLayout";
import type { FlatLinkRowModel } from "../row-models/flatLinkRowModel";
import { createFlatVirtualGridRuntimeModel } from "../row-models/flatVirtualGridRuntimeModel";
import { isContentBottomInPreloadRangeFromMetrics } from "../core/preloadRange";
import type { VirtualListStableMeasurementContext } from "../dom/virtualMeasurementController";
import { createVirtualListMeasurementState } from "../dom/virtualListMeasurementState";
import { createCardVirtualListPolicy } from "../cardVirtualListPolicy";
import {
	createResolvedCardLayoutSettingsMemo,
	type CardLayoutSettings,
} from "ui/shared/layout/cardLayoutCssVars";
import { getOptionalOwnerWindow } from "ui/shared/dom/realmSafeDom";
import { scheduleAnimationFrame } from "ui/shared/scheduling/frame";
import {
	createSectionPaginationState,
	type SectionPaginationApplicationStore,
} from "../pagination";
import { useVirtualList } from "./useVirtualList.svelte";
import type { VirtualListLogicalCell } from "../logicalCell";
import type { RenderRevision, RenderRevisionFallbackPolicy } from "../renderRevision";
import type { VirtualNavigationTarget } from "../types";
import type { VirtualListItemRenderArgs } from "./renderArgs";
import { flushVirtualScrollMeasurement as flushCachedVirtualScrollMeasurement } from "../dom/flushVirtualScrollMeasurement";
import {
	DEFAULT_FLAT_GRID_LAYOUT,
	isSameFlatGridLayout,
	resolveFlatGridLayoutMeasurement,
	type ConfiguredCardLayout,
	type VirtualGridLayout,
} from "../dom/flatGridLayoutMeasurement";
import { createVirtualListControllerAdapter } from "./virtualListControllerAdapter";
import { createResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import { DISABLED_PREVIEW_SURFACE } from "features/card-preview/runtime/previewRuntime";
import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
import {
	createVirtualCardInteractionController,
	type VirtualCardInteractionBinding,
} from "ui/interactions/virtualCardInteractionController";
import { useAppContext } from "ui/context/linkContext";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { DEFAULT_SETTINGS } from "features/settings/model";

interface FlatVirtualGridApplicationSettings extends CardLayoutSettings {
	previewActivationAheadRows?: number;
	previewDomCommitsPerSecond?: number;
	enableTwoRowMountedOverscan?: boolean;
}

interface FlatVirtualGridApplicationStore extends SectionPaginationApplicationStore {
	settings?: FlatVirtualGridApplicationSettings;
}

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
	item?: Snippet<[VirtualListItemRenderArgs<T>]>;
	empty?: Snippet;
	initialVisibleCount?: number | undefined;
	loadMoreIncrement?: number;
	sectionId?: string;
	applicationStore?: FlatVirtualGridApplicationStore;
	className?: string;
	paginationMode?: "button" | "infinite-scroll";
	infiniteScrollRootMargin?: string;
	remountCellBodyOnKeyChange?: boolean;
	/** Resolves immutable preview input for the surface-owned slot controller. */
	resolveItemPreviewRequest?: (item: T, index: number) => CardPreviewRequest | null;
	/** Resolves the current item descriptor without card-owned effects. */
	resolveItemInteractionDescriptor?: (
		item: T,
		index: number,
	) => ItemInteractionDescriptor | null;
}

const MAX_CHAINED_INFINITE_SCROLL_LOADS = 2;
const EMPTY_MOUNTED_ROWS: readonly MountedVirtualGridRowSlice<never>[] = [];
type FlatMountedItemCell<T> = MountedVirtualGridCell<T> & {
	readonly cell: Extract<VirtualListLogicalCell<T>, { kind: "item" }>;
};

export function useFlatVirtualGridList<T>(
	props: FlatVirtualGridListProps<T>,
	frameCoordinator?: VirtualFrameCoordinator,
) {
	let applicationStore = props.applicationStore;
	if (!applicationStore) {
		try {
			applicationStore =
				getContext<FlatVirtualGridApplicationStore>("applicationStore");
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
	const rowSlotAllocator = createResidentRowSlotAllocator();
	let lastResolvedVisibilityPolicyRowHeight: number | undefined;
	let lastResolvedVisibilityPolicyGap: number | undefined;
	let lastResolvedVisibilityPolicyAheadRows: number | undefined;
	let lastResolvedMountedOverscanRows: 1 | 2 | undefined;
	let lastResolvedVisibilityPolicy:
		| ReturnType<typeof createCardVirtualListPolicy>
		| undefined;
	const resolveVisibilityPolicy = (
		nextLayout: VirtualGridLayout,
	): ReturnType<typeof createCardVirtualListPolicy> => {
		const mountedOverscanRows = enableTwoRowMountedOverscan ? 2 : 1;
		if (
			!lastResolvedVisibilityPolicy ||
			lastResolvedVisibilityPolicyRowHeight !== nextLayout.rowHeight ||
			lastResolvedVisibilityPolicyGap !== nextLayout.gap ||
			lastResolvedVisibilityPolicyAheadRows !== previewActivationAheadRows ||
			lastResolvedMountedOverscanRows !== mountedOverscanRows
		) {
			lastResolvedVisibilityPolicyRowHeight = nextLayout.rowHeight;
			lastResolvedVisibilityPolicyGap = nextLayout.gap;
			lastResolvedVisibilityPolicyAheadRows = previewActivationAheadRows;
			lastResolvedMountedOverscanRows = mountedOverscanRows;
			lastResolvedVisibilityPolicy = createCardVirtualListPolicy({
				layout: nextLayout,
				previewActivationAheadRows,
				mountedOverscanRows,
			});
		}
		return lastResolvedVisibilityPolicy!;
	};
	let sectionExpandedLimits = $state.raw<Record<string, number>>({});
	let sectionRootEl = $state<HTMLDivElement | null>(null);
	let contentEl = $state<HTMLDivElement | null>(null);
	let interactionShadowRoot = $state<ShadowRoot | null>(null);
	let infiniteScrollSentinelEl = $state<HTMLDivElement | null>(null);
	let measurement = $state(createVirtualListMeasurementState());
	let loadScheduled = $state(false);
	let chainedInfiniteScrollLoads = $state(0);
	let layout = $state.raw(DEFAULT_FLAT_GRID_LAYOUT);
	const resolveConfiguredCardLayout = createResolvedCardLayoutSettingsMemo();
	const configuredCardLayout = $derived.by(() =>
		resolveConfiguredCardLayout(applicationStore?.settings),
	);
	const previewActivationAheadRows = $derived(
		applicationStore?.settings?.previewActivationAheadRows ?? 1,
	);
	const enableTwoRowMountedOverscan = $derived(
		applicationStore?.settings?.enableTwoRowMountedOverscan ?? false,
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
	const logicalCellSource = $derived.by(() => {
		return flatGridModel.resolveLogicalCellSource({
			items,
			getKey: props.getKey,
			itemsRevision: props.itemsRevision,
			keyRevision: props.keyRevision,
			itemRenderRevisionToken: props.itemRenderRevisionToken,
			getItemRenderRevision: props.getItemRenderRevision,
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
	const syncCardSlots = (
		rows: readonly MountedVirtualGridRowSlice<T>[],
		previewRange: RowRange,
	): void => {
		const interactionCards: VirtualCardInteractionBinding[] = [];
		previewSurface.beginBindings();
		try {
			for (const row of rows) {
				for (const mountedCell of row.cells) {
					if (mountedCell.cell.kind !== "item") continue;
					const { item, itemIndex } = mountedCell.cell;
					const slotId = String(mountedCell.renderSlotKey);
					const previewRequest = props.resolveItemPreviewRequest?.(
						item,
						itemIndex,
					);
					if (previewRequest) {
						previewSurface.bindSlot(
							slotId,
							mountedCell.rowIndex,
							mountedCell.key,
							previewRequest,
						);
					}
					const descriptor = props.resolveItemInteractionDescriptor?.(
						item,
						itemIndex,
					);
					if (descriptor) interactionCards.push({ slotId, descriptor });
				}
			}
		} finally {
			previewSurface.endBindings();
		}
		previewSurface.setActiveRange(previewRange.start, previewRange.end, true);
		interactionController.syncCards(interactionCards);
	};
	const virtualList = useVirtualList<
		VirtualListLogicalCell<T>,
		FlatLinkRowModel<T>,
		MountedVirtualGridCell<T>,
		MountedVirtualGridCellsBuildResult<T>
	>({
		buildMountedCells: ({ rowModel, rowRange, previousBuild }) =>
			buildMountedVirtualGridCellsFromRowModel({
				rowModel,
				rowRange,
				previousBuild,
				renderRevisionFallbackPolicy: props.renderRevisionFallbackPolicy,
				rowSlotAllocator,
			}),
		mountedRowsReconciler: rowSlotAllocator,
		onStableVisibleRange: () => {
			measurement.hasStableVisibleRange = true;
		},
		onSnapshotUpdated: (snapshot, reconciliationState) => {
			syncCardSlots(
				reconciliationState.mountedBuild?.rowSlices ?? EMPTY_MOUNTED_ROWS,
				snapshot.ranges.previewVisible,
			);
		},
	});
	const contentHeight = $derived(virtualList.getTotalHeight(layout.contentHeight));
	const mountedCells = $derived<readonly MountedVirtualGridCell<T>[]>(
		virtualList.getMountedCells(),
	);
	const mountedRows = $derived.by<readonly MountedVirtualGridRowSlice<T>[]>(() => {
		const rowsBySlot =
			virtualList.getReconciliationState().mountedBuild?.rowsBySlot;
		return rowsBySlot && rowsBySlot.length > 0 ? rowsBySlot : EMPTY_MOUNTED_ROWS;
	});
	const virtualListController = createVirtualListControllerAdapter<
		FlatLinkRowModel<T>,
		VirtualGridLayout
	>({
		getRootEl: () => sectionRootEl,
		measurement,
		getContext: () => layout,
		hasRenderableContent: () => itemCount > 0,
		resolveRowModel: resolveFlatLinkRowModel,
		resolveVisibilityPolicy,
		applyRangeMeasurement: (nextMeasurement, nextLayout, precomputedRanges) =>
			virtualList.applyMeasurement({
				rowModel: resolveFlatLinkRowModel(nextLayout),
				scrollTop: nextMeasurement.scrollTop,
				viewportHeight: nextMeasurement.viewportHeight,
				sectionTop: nextMeasurement.sectionTop,
				isStableMeasurement: nextMeasurement.isStableMeasurement,
				isScrollActive: nextMeasurement.isScrollActive,
				hasStableVisibleRange: measurement.hasStableVisibleRange,
				precomputedRanges,
				visibilityPolicy: resolveVisibilityPolicy(nextLayout),
			}),
		resolveLayoutMeasurement: (nextMeasurement, rootEl) => {
			const layoutMeasurement = resolveFlatGridLayoutMeasurement({
				rootEl,
				rootRect: nextMeasurement.sectionRect,
				measuredWidth: measurement.measuredWidth,
				scrollContainerEl: measurement.scrollContainerEl,
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
		onStableMeasurement: maybeScheduleInfiniteScrollLoad,
	});

	const scheduleLayoutMeasurementForCardLayout = (
		_nextCardLayout: ConfiguredCardLayout | null,
	): void => {
		virtualListController.scheduleLayoutMeasurement();
	};

	const syncVirtualListForRenderableContent = (
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

		const currentSnapshot = virtualList.getSnapshot();
		if (currentSnapshot?.rowModel === nextRowModel) {
			return;
		}

		if (currentSnapshot) {
			virtualList.recompute({ rowModel: nextRowModel });
		}

		virtualListController.scheduleLayoutMeasurement();
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
		syncVirtualListForRenderableContent(logicalCellCount, rowModel);
	});

	$effect(() => {
		void props.resolveItemPreviewRequest;
		void props.resolveItemInteractionDescriptor;
		const snapshot = virtualList.getSnapshot();
		if (!snapshot) return;
		const rows =
			virtualList.getReconciliationState().mountedBuild?.rowSlices ??
			EMPTY_MOUNTED_ROWS;
		syncCardSlots(rows, snapshot.ranges.previewVisible);
	});

	onDestroy(() => {
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
		snapshot: Parameters<typeof flushCachedVirtualScrollMeasurement>[0]["snapshot"],
	): void => {
		flushCachedVirtualScrollMeasurement({
			measurement,
			snapshot,
			updateFromCachedMeasurement: (metrics) =>
				virtualListController.updateFromCachedMeasurement(metrics),
		});
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
	): VirtualListItemRenderArgs<T> => {
		const itemCell = mountedCell as FlatMountedItemCell<T>;
		return {
			item: itemCell.cell.item,
			index: itemCell.cell.itemIndex,
			observerRoot,
			rowIndex: itemCell.rowIndex,
			activationCandidateId: itemCell.key,
			previewSlotId: String(itemCell.renderSlotKey),
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
		get observerRoot() {
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
		flushVirtualScrollMeasurement,
		createItemRenderArgs,
		loadNextPage,
	};
}
