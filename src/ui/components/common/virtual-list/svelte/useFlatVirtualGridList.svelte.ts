import { tick, untrack, getContext, type Snippet } from "svelte";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
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
	resolveCardLayoutSettings,
	type CardLayoutSettings,
} from "ui/utils/cardLayoutCssVars";
import { getOptionalOwnerWindow } from "ui/utils/realmSafeDom";
import { scheduleAnimationFrame } from "ui/utils/frame";
import {
	createSectionPaginationState,
	type SectionPaginationApplicationStore,
} from "../pagination";
import { useVirtualList } from "./useVirtualList.svelte";
import type { VirtualListLogicalCell } from "../logicalCell";
import { resolveVirtualizedItemVisibilityForPreviewRange } from "./virtualizedItemVisibilityState.svelte";
import type { RenderRevision, RenderRevisionFallbackPolicy } from "../renderRevision";
import type { VirtualNavigationTarget } from "../types";
import type { VirtualListItemRenderArgs } from "./renderArgs";
import {
	PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	type RowPreviewActivationRuntime,
} from "features/preview/scheduling/rowPreviewActivationRuntime";
import { flushVirtualScrollMeasurement as flushCachedVirtualScrollMeasurement } from "../dom/flushVirtualScrollMeasurement";
import { createFlatGridMeasurementAdapter } from "./flatGridMeasurementAdapter";
import {
	DEFAULT_FLAT_GRID_LAYOUT,
	type ConfiguredCardLayout,
	type VirtualGridLayout,
} from "../dom/flatGridLayoutMeasurement";
import { createFlatGridVisibilityAdapter } from "./flatGridVisibilityAdapter";
import { createFlatGridControllerAdapter } from "./flatGridControllerAdapter";
import { createPooledRowSlotAllocator } from "../core/reconciliation/pooledRowSlotAllocator";

interface FlatVirtualGridApplicationSettings extends CardLayoutSettings {
	previewActivationAheadRows?: number;
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
	onMountedCellsChange?: (cells: readonly MountedVirtualGridCell<T>[]) => void;
}

const MAX_CHAINED_INFINITE_SCROLL_LOADS = 2;
const EMPTY_MOUNTED_ROWS: readonly MountedVirtualGridRowSlice<never>[] = [];
type FlatMountedItemCell<T> = MountedVirtualGridCell<T> & {
	readonly cell: Extract<VirtualListLogicalCell<T>, { kind: "item" }>;
};

export function useFlatVirtualGridList<T>(props: FlatVirtualGridListProps<T>) {
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
	const rowPreviewActivationRuntime = getContext<
		RowPreviewActivationRuntime | undefined
	>(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY);
	const visibilityAdapter = createFlatGridVisibilityAdapter<T>({
		onRowVisibilityChanged: (rowIndex, visibility) => {
			rowPreviewActivationRuntime?.setRowVisibility(rowIndex, visibility);
		},
		onRowCleared: (rowIndex) => {
			rowPreviewActivationRuntime?.clearRow(rowIndex);
		},
	});
	const rowSlotAllocator = createPooledRowSlotAllocator();
	let lastResolvedActiveScrollPolicyLayout: VirtualGridLayout | undefined;
	let lastResolvedActiveScrollPolicy:
		| ReturnType<typeof createCardVirtualListPolicy>
		| undefined;
	const resolveActiveScrollPolicy = (
		nextLayout: VirtualGridLayout,
	): ReturnType<typeof createCardVirtualListPolicy> => {
		if (lastResolvedActiveScrollPolicyLayout !== nextLayout) {
			lastResolvedActiveScrollPolicyLayout = nextLayout;
			lastResolvedActiveScrollPolicy = createCardVirtualListPolicy({
				layout: nextLayout,
				previewActivationAheadRows,
			});
		}
		return lastResolvedActiveScrollPolicy!;
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
				rowSlotAllocator,
			}),
		mountedRowsReconciler: rowSlotAllocator,
		onStableVisibleRange: () => {
			measurement.hasStableVisibleRange = true;
		},
		visibilityMetadataPolicy: { type: "caller-managed" },
		onSnapshotUpdated: (snapshot, reconciliationState) => {
			visibilityAdapter.syncVisibilityStates({
				mountedRows:
					reconciliationState.mountedBuild?.rowSlices ?? EMPTY_MOUNTED_ROWS,
				mountedRange: snapshot.ranges.mounted,
				previewRange: snapshot.ranges.previewVisible,
				rowModel: snapshot.rowModel,
			});
		},
	});
	const virtualListSnapshot = $derived(virtualList.getSnapshot());
	const contentHeight = $derived(virtualList.getTotalHeight(layout.contentHeight));
	const mountedCells = $derived<readonly MountedVirtualGridCell<T>[]>(
		virtualList.getMountedCells(),
	);
	const mountedRows = $derived.by<readonly MountedVirtualGridRowSlice<T>[]>(() => {
		const rowsBySlot = virtualList.getReconciliationState().mountedBuild?.rowsBySlot;
		return rowsBySlot && rowsBySlot.length > 0 ? rowsBySlot : EMPTY_MOUNTED_ROWS;
	});
	const mountedCellsForChange = $derived<readonly MountedVirtualGridCell<T>[]>(
		virtualList.getMountedCellsForChange(),
	);
	let lastEmptyMountedCellsNotification: unknown = null;
	const flatGridMeasurementAdapter = createFlatGridMeasurementAdapter<
		T,
		VirtualGridLayout
	>({
		resolveRowModel: resolveFlatLinkRowModel,
		resolveVisibilityPolicy: resolveActiveScrollPolicy,
		applyMeasurement: ({
			rowModel,
			scrollTop,
			viewportHeight,
			sectionTop,
			isStableMeasurement,
			isScrollActive,
			precomputedRanges,
			visibilityPolicy,
		}) =>
			virtualList.applyMeasurement({
				rowModel,
				scrollTop,
				viewportHeight,
				sectionTop,
				isStableMeasurement,
				isScrollActive,
				hasStableVisibleRange: measurement.hasStableVisibleRange,
				precomputedRanges,
				visibilityPolicy,
			}),
		getActiveVisibilityRowModel: () =>
			visibilityAdapter.getActiveRowModel() ??
			virtualList.getSnapshot()?.rowModel ??
			null,
		syncActiveScrollPreviewRange: ({ previewVisible, rowModel }) => {
			visibilityAdapter.syncVisibilityStates({
				mountedRows: visibilityAdapter.getMountedRows(),
				mountedRange: visibilityAdapter.getMountedRange(),
				previewRange: previewVisible,
				rowModel,
			});
		},
	});

	const virtualListController = createFlatGridControllerAdapter<T>({
		getRootEl: () => sectionRootEl,
		measurement,
		getLayout: () => layout,
		setLayout: (nextLayout) => {
			layout = nextLayout;
		},
		getConfiguredCardLayout: () => configuredCardLayout,
		getLogicalCellCount: () => logicalCellCount,
		getItemCount: () => itemCount,
		measurementAdapter: flatGridMeasurementAdapter,
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
		notifyEmptyMountedCellsChange(virtualListSnapshot);
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
		const visibilityState = visibilityAdapter.visibilityStates.getOrCreateState(
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
