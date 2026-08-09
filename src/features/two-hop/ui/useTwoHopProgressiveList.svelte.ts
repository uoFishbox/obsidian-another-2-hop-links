import { onDestroy, tick, untrack } from "svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionProjection } from "features/two-hop/ui/twoHopSectionProjection";
import {
	compileFixedGridLayout,
	resolveTwoHopRowFromScrollOffset,
	type TwoHopGeometry,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	appendTwoHopProgressivePlan,
	compileTwoHopProgressivePlan,
	resolveInitialProgressiveMountedRowEnd,
	resolveNextProgressiveMountedRowEnd,
	resolveMountedProgressiveRow,
	TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
	type TwoHopProgressivePlan,
} from "features/two-hop/ui/twoHopProgressivePlan";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import { DISABLED_PREVIEW_SURFACE } from "features/card-preview/runtime/previewRuntime";
import type {
	VirtualPreviewBinding,
	VirtualPreviewSurface,
} from "features/card-preview/scheduling/virtualPreviewSurface";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createResolvedCardLayoutSettingsMemo } from "ui/shared/layout/cardLayoutCssVars";
import { resolveCachedCardGridLayoutBase } from "ui/virtualization/dom/virtualListCardLayout";
import {
	DEFAULT_VIEW_PLAN_CARD_LAYOUT,
	DEFAULT_VIEW_PLAN_LAYOUT,
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "ui/virtualization/svelte/viewPlanLayout";
import { findNearestScrollContainer } from "ui/virtualization/dom/scrollContainer";
import { createTwoHopCardHydrator } from "features/two-hop/ui/twoHopCardHydrator";
import {
	EMPTY_TWO_HOP_WINDOW,
	isSameTwoHopWindow,
	resolveTwoHopWindow,
	type TwoHopWindowSnapshot,
} from "features/two-hop/ui/twoHopWindowPolicy";
import {
	observeTwoHopViewport,
	type TwoHopViewportObservation,
} from "features/two-hop/ui/twoHopViewportObservation";

export interface TwoHopProgressiveListProps {
	/** Stable identity of the displayed file and search scope. */
	readonly documentIdentity: string;
	readonly sections: readonly TwoHopSectionModel[];
	readonly applicationStore: ApplicationStore;
	readonly previewDependencies?: TwoHopPreviewDependencies;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly paginationScope?: string;
	readonly previewActive?: boolean;
	/** Rows to hydrate from the start while the whole list is below the viewport. */
	readonly offscreenBootstrapPreviewRows?: number;
	/** Explicit invalidation value for card models resolved by resolveItemCardModel. */
	readonly cardModelRevision: unknown;
	readonly resolveItemCardModel?: (
		item: TwoHopItemModel,
		presentation: TwoHopCardPresentationState,
		revision: unknown,
	) => CardRenderModel;
}

interface LayoutAnchor {
	readonly logicalKey: string;
	readonly viewportOffset: number;
	readonly scrollTop: number;
	readonly scrollRoot: HTMLElement | null;
}

type SectionPublicationKind = "identity-reset" | "data-revision";
const PREVIEW_WINDOW_COMMIT_TASK_KEY = "two-hop-progressive-preview-window-apply";

/** Owns append-only chunk publication, lazy model hydration, and bounded preview state. */
export function useTwoHopProgressiveList(
	props: TwoHopProgressiveListProps,
	frameCoordinator: VirtualFrameCoordinator,
) {
	const applicationStore = props.applicationStore;
	const sectionProjection = createTwoHopSectionProjection({
		sections: props.sections,
		applicationStore,
		initialVisibleCount: props.initialVisibleCount,
		loadMoreIncrement: props.loadMoreIncrement,
		paginationScope: props.paginationScope,
	});
	const initialSections = sectionProjection.getSections();
	const initialGeometry = compileFixedGridLayout(
		initialSections,
		DEFAULT_VIEW_PLAN_LAYOUT,
	);
	const initialMountedRowEnd = resolveInitialProgressiveMountedRowEnd(
		initialGeometry.rowCount,
	);
	let sections = $state.raw<readonly TwoHopSectionModel[]>(initialSections);
	let layout = $state.raw<ViewPlanLayoutMetrics>(DEFAULT_VIEW_PLAN_LAYOUT);
	let geometry = $state.raw<TwoHopGeometry>(initialGeometry);
	let plan = $state.raw<TwoHopProgressivePlan>(
		compileTwoHopProgressivePlan(
			initialSections,
			initialGeometry,
			initialMountedRowEnd,
		),
	);
	let rootEl = $state<HTMLDivElement | null>(null);
	let contentEl = $state<HTMLDivElement | null>(null);
	let sentinelEl = $state<HTMLDivElement | null>(null);
	let disposed = false;

	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore.settings),
	);
	const previewSurface: VirtualPreviewSurface = props.previewDependencies
		? props.previewDependencies.previewRuntime.createSurface({
				frameCoordinator,
				resolveSearchMatchPosition:
					props.previewDependencies.resolveSearchMatchPosition,
			})
		: DISABLED_PREVIEW_SURFACE;
	let committedWindow: TwoHopWindowSnapshot = EMPTY_TWO_HOP_WINDOW;
	let pendingWindow: TwoHopWindowSnapshot | null = null;
	let sentinelObserver: IntersectionObserver | undefined;
	let previewScrollActive = false;
	let previewViewportObservation: TwoHopViewportObservation | null = null;
	let previewScrollContainer: HTMLElement | null = null;
	let previewOwnerWindow: Window | null = null;
	let contentTopInScrollSpace = 0;
	let previewViewportHeight = 0;
	let lastMeasuredRootWidth = 0;
	let pendingRootWidth: number | null = null;
	let preserveAnchorForNextLayout: boolean | null = null;
	let skipViewportGeometryForNextLayout = false;
	let previewHostRows = $state.raw<ReadonlySet<number>>(new Set());
	let lastPreviewSurfaceActive = isPreviewSurfaceActive();
	let previewSnapshotPublished = false;
	let lastDocumentIdentity = props.documentIdentity;
	let lastCardModelRevision = props.cardModelRevision;
	const cardHydrator = createTwoHopCardHydrator({
		frameCoordinator,
		getPlan: () => untrack(() => plan),
		getRevision: () => untrack(() => props.cardModelRevision),
		getResolver: () => untrack(() => props.resolveItemCardModel),
		isPreviewActive: isPreviewSurfaceActive,
		onPreviewModelsChanged: publishPreviewSnapshot,
	});

	function isPreviewControlActive(): boolean {
		return props.previewActive !== false;
	}

	function isPreviewSurfaceActive(): boolean {
		return props.previewDependencies !== undefined && isPreviewControlActive();
	}

	function readPreviewScrollTop(): number {
		return previewScrollContainer?.scrollTop ?? previewOwnerWindow?.scrollY ?? 0;
	}

	function measurePreviewViewportGeometry(): void {
		if (!contentEl || !previewOwnerWindow) return;
		const contentRect = contentEl.getBoundingClientRect();
		if (previewScrollContainer) {
			const scrollerRect = previewScrollContainer.getBoundingClientRect();
			contentTopInScrollSpace =
				contentRect.top - scrollerRect.top + previewScrollContainer.scrollTop;
			previewViewportHeight = previewScrollContainer.clientHeight;
			return;
		}
		contentTopInScrollSpace = contentRect.top + previewOwnerWindow.scrollY;
		previewViewportHeight = previewOwnerWindow.innerHeight;
	}

	function collectPreviewBindings(): VirtualPreviewBinding[] {
		if (!isPreviewSurfaceActive()) return [];
		const bindings: VirtualPreviewBinding[] = [];
		const activePlan = untrack(() => plan);
		for (
			let rowIndex = committedWindow.prepared.start;
			rowIndex < committedWindow.prepared.end;
			rowIndex += 1
		) {
			const row = resolveMountedProgressiveRow(activePlan, rowIndex);
			if (!row) continue;
			for (const cell of row.cells) {
				if (cell.kind !== "item") continue;
				const request = cardHydrator.getModel(cell.logicalKey)?.previewRequest;
				if (!request) continue;
				bindings.push({
					slotId: cell.logicalKey,
					rowIndex,
					ownerKey: cell.logicalKey,
					request,
				});
			}
		}
		return bindings;
	}

	function syncPreviewHostRows(): void {
		if (!isPreviewControlActive()) {
			previewHostRows = new Set();
			return;
		}
		const rows = new Set<number>();
		for (
			let rowIndex = committedWindow.prepared.start;
			rowIndex < committedWindow.prepared.end;
			rowIndex += 1
		) {
			rows.add(rowIndex);
		}
		previewHostRows = rows;
	}

	function publishPreviewSnapshot(force = false): void {
		if (disposed) return;
		const active = isPreviewSurfaceActive();
		if (!active && previewSnapshotPublished && !force) return;
		previewSnapshotPublished = true;
		previewSurface.commit({
			active,
			activeRange: committedWindow.active,
			bindings: collectPreviewBindings(),
		});
	}

	function publishCardDemand(): void {
		cardHydrator.setDemand({
			foreground: committedWindow.active,
			background: isPreviewSurfaceActive()
				? committedWindow.prepared
				: EMPTY_TWO_HOP_WINDOW.prepared,
			scrollActive: previewScrollActive,
		});
	}

	function commitPendingWindow(): void {
		if (disposed || !pendingWindow) return;
		committedWindow = pendingWindow;
		pendingWindow = null;
		syncPreviewHostRows();
		publishCardDemand();
		publishPreviewSnapshot();
	}

	function flushPreviewRangeFromScroll(
		forceCommit = false,
		scrollTop = readPreviewScrollTop(),
		viewportHeight = previewViewportHeight,
	): void {
		if (disposed) return;
		const nextWindow = resolveTwoHopWindow({
			geometry: untrack(() => geometry),
			mountedRowEnd: untrack(() => plan.mountedRowEnd),
			scrollTop,
			contentTopInScrollSpace,
			viewportHeight,
			offscreenBootstrapRows: props.offscreenBootstrapPreviewRows ?? 0,
			previewEnabled: isPreviewControlActive(),
			previous: committedWindow,
		});
		previewViewportObservation?.publishScrollCoverage(nextWindow.coverage);
		if (!forceCommit && isSameTwoHopWindow(committedWindow, nextWindow)) {
			committedWindow = nextWindow;
			pendingWindow = null;
			frameCoordinator.cancel("post-paint", PREVIEW_WINDOW_COMMIT_TASK_KEY);
			return;
		}
		pendingWindow = nextWindow;
		frameCoordinator.schedule(
			"post-paint",
			PREVIEW_WINDOW_COMMIT_TASK_KEY,
			commitPendingWindow,
		);
	}

	function setPreviewScrollActive(active: boolean): void {
		if (previewScrollActive === active) return;
		previewScrollActive = active;
		publishCardDemand();
	}

	function runObservedScrollMeasurement(metrics: {
		readonly scrollTop: number;
		readonly viewportHeight: number;
	}): void {
		previewViewportHeight = metrics.viewportHeight;
		flushPreviewRangeFromScroll(false, metrics.scrollTop, metrics.viewportHeight);
	}

	function runObservedLayoutMeasurement(): void {
		if (disposed || !rootEl || !contentEl) return;
		if (pendingRootWidth !== null && pendingRootWidth <= 0) {
			lastMeasuredRootWidth = 0;
			pendingRootWidth = null;
			preserveAnchorForNextLayout = null;
			return;
		}
		const preserveAnchor =
			preserveAnchorForNextLayout ??
			(lastMeasuredRootWidth > 0 && previewViewportHeight > 0);
		preserveAnchorForNextLayout = null;
		const layoutChanged = measureLayout(preserveAnchor);
		if (pendingRootWidth !== null) {
			lastMeasuredRootWidth = Math.max(0, pendingRootWidth);
			pendingRootWidth = null;
		}
		if (skipViewportGeometryForNextLayout) {
			skipViewportGeometryForNextLayout = false;
			flushPreviewRangeFromScroll(layoutChanged);
			return;
		}
		measurePreviewViewportGeometry();
		flushPreviewRangeFromScroll(layoutChanged);
	}

	function rebuildSentinelObserver(): void {
		sentinelObserver?.disconnect();
		sentinelObserver = undefined;
		if (!rootEl || typeof IntersectionObserver === "undefined") return;

		const observerRoot = findNearestScrollContainer(rootEl);
		const chunkPreloadDistancePx =
			geometry.rowStride * TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK;
		sentinelObserver = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) loadNextChunk();
			},
			{
				root: observerRoot,
				rootMargin: `0px 0px ${chunkPreloadDistancePx}px 0px`,
			},
		);
		if (sentinelEl) sentinelObserver.observe(sentinelEl);
	}

	function loadNextChunk(): void {
		const currentMountedRowEnd = plan.mountedRowEnd;
		const nextEnd = resolveNextProgressiveMountedRowEnd(
			currentMountedRowEnd,
			geometry.rowCount,
		);
		if (nextEnd === currentMountedRowEnd) return;
		plan = appendTwoHopProgressivePlan(sections, geometry, plan, nextEnd);
		flushPreviewRangeFromScroll();
	}

	function captureLayoutAnchor(): LayoutAnchor | null {
		if (!rootEl?.shadowRoot) return null;
		const anchorRowIndex = resolveTwoHopRowFromScrollOffset(
			geometry,
			readPreviewScrollTop() - contentTopInScrollSpace,
		);
		if (anchorRowIndex === null || anchorRowIndex >= plan.mountedRowEnd) {
			return null;
		}
		const rowElement = rootEl.shadowRoot.querySelector<HTMLElement>(
			`[data-ccl-progressive-row="${anchorRowIndex}"]`,
		);
		const element = rowElement?.querySelector<HTMLElement>(
			"[data-ccl-logical-key]",
		);
		if (!element) return null;
		const scrollRoot = findNearestScrollContainer(rootEl);
		const viewportHeight =
			scrollRoot?.clientHeight ?? previewOwnerWindow?.innerHeight ?? 0;
		if (viewportHeight <= 0) return null;
		const viewportTop = scrollRoot?.getBoundingClientRect().top ?? 0;
		const viewportBottom = viewportTop + viewportHeight;
		const rect = element.getBoundingClientRect();
		if (
			rect.width <= 0 ||
			rect.height <= 0 ||
			rect.bottom <= viewportTop ||
			rect.top >= viewportBottom
		) {
			return null;
		}
		return {
			logicalKey: element.dataset.cclLogicalKey ?? "",
			viewportOffset: rect.top - viewportTop,
			scrollTop: readPreviewScrollTop(),
			scrollRoot,
		};
	}

	async function restoreLayoutAnchor(anchor: LayoutAnchor | null): Promise<void> {
		if (!anchor?.logicalKey || !rootEl?.shadowRoot) return;
		await tick();
		const escapedKey = CSS.escape(anchor.logicalKey);
		const element = rootEl.shadowRoot.querySelector<HTMLElement>(
			`[data-ccl-logical-key="${escapedKey}"]`,
		);
		if (!element) return;
		const scrollRoot = findNearestScrollContainer(rootEl);
		if (scrollRoot !== anchor.scrollRoot) return;
		if (Math.abs(readPreviewScrollTop() - anchor.scrollTop) >= 0.5) return;
		const viewportTop = scrollRoot?.getBoundingClientRect().top ?? 0;
		const delta =
			element.getBoundingClientRect().top - viewportTop - anchor.viewportOffset;
		if (Math.abs(delta) < 0.5) return;
		if (scrollRoot) scrollRoot.scrollTop += delta;
		else rootEl.ownerDocument.defaultView?.scrollBy({ top: delta });
	}

	function measureLayout(preserveAnchor = true): boolean {
		if (!rootEl) return false;
		const rect = rootEl.getBoundingClientRect();
		lastMeasuredRootWidth = Math.max(0, rect.width);
		const layoutBase = resolveCachedCardGridLayoutBase({
			rootEl,
			rootRect: rect,
			measuredWidth: rect.width > 0 ? rect.width : null,
			defaults: DEFAULT_VIEW_PLAN_CARD_LAYOUT,
			listKind: "view-plan",
			scrollContainerEl: findNearestScrollContainer(rootEl),
			configuredLayout,
		});
		const nextLayout: ViewPlanLayoutMetrics = {
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
		if (isSameViewPlanLayout(layout, nextLayout)) return false;
		const anchor = preserveAnchor ? captureLayoutAnchor() : null;
		const nextGeometry = compileFixedGridLayout(sections, nextLayout);
		const nextMountedRowEnd = Math.min(plan.mountedRowEnd, nextGeometry.rowCount);
		layout = nextLayout;
		geometry = nextGeometry;
		plan = compileTwoHopProgressivePlan(sections, nextGeometry, nextMountedRowEnd);
		void restoreLayoutAnchor(anchor);
		return true;
	}

	function publishSections(
		nextSections: readonly TwoHopSectionModel[],
		kind: SectionPublicationKind,
	): void {
		if (nextSections === sections && kind === "data-revision") return;
		const anchor = kind === "data-revision" ? captureLayoutAnchor() : null;
		const nextGeometry = compileFixedGridLayout(nextSections, layout);
		const nextMountedRowEnd =
			kind === "identity-reset"
				? resolveInitialProgressiveMountedRowEnd(nextGeometry.rowCount)
				: Math.min(
						nextGeometry.rowCount,
						Math.max(
							plan.mountedRowEnd,
							resolveInitialProgressiveMountedRowEnd(
								nextGeometry.rowCount,
							),
						),
					);
		sections = nextSections;
		geometry = nextGeometry;
		const nextPlan = compileTwoHopProgressivePlan(
			nextSections,
			nextGeometry,
			nextMountedRowEnd,
		);
		plan = nextPlan;
		if (kind === "identity-reset") {
			committedWindow = EMPTY_TWO_HOP_WINDOW;
			pendingWindow = null;
			frameCoordinator.cancel("post-paint", PREVIEW_WINDOW_COMMIT_TASK_KEY);
			cardHydrator.clear();
		} else {
			cardHydrator.reconcile(nextPlan);
		}
		flushPreviewRangeFromScroll(true);
		void restoreLayoutAnchor(anchor);
	}

	$effect(() => {
		const nextDocumentIdentity = props.documentIdentity;
		const nextSections = sectionProjection.setInput({
			sections: props.sections,
			paginationScope: props.paginationScope ?? "",
			initialVisibleCount: props.initialVisibleCount,
			loadMoreIncrement: props.loadMoreIncrement,
		});
		const identityChanged = nextDocumentIdentity !== lastDocumentIdentity;
		if (identityChanged || nextSections !== sections) {
			lastDocumentIdentity = nextDocumentIdentity;
			publishSections(
				nextSections,
				identityChanged ? "identity-reset" : "data-revision",
			);
		}
	});

	$effect(() => {
		const revision = props.cardModelRevision;
		if (revision === lastCardModelRevision) return;
		lastCardModelRevision = revision;
		cardHydrator.refreshDemand();
	});

	$effect(() => {
		const element = rootEl;
		const content = contentEl;
		void configuredLayout;
		if (!element || !content) return;
		const ownerWindow = element.ownerDocument.defaultView;
		if (!ownerWindow) return;

		previewOwnerWindow = ownerWindow;
		const observation = untrack(() =>
			observeTwoHopViewport({
				rootEl: element,
				frameCoordinator,
				getCachedViewportHeight: () => previewViewportHeight,
				getScrollCoverage: () => (pendingWindow ?? committedWindow).coverage,
				onRootWidthChange: (width) => {
					preserveAnchorForNextLayout =
						lastMeasuredRootWidth > 0 && previewViewportHeight > 0;
					if (width <= 0) lastMeasuredRootWidth = 0;
					pendingRootWidth = width;
					skipViewportGeometryForNextLayout = true;
				},
				onScrollContainerChange: (scrollContainer) => {
					previewScrollContainer = scrollContainer;
					previewOwnerWindow = element.ownerDocument.defaultView;
				},
				onScrollActiveChange: setPreviewScrollActive,
				runInitialLayoutMeasurement: runObservedLayoutMeasurement,
				runLayoutMeasurement: runObservedLayoutMeasurement,
				runScrollMeasurement: runObservedScrollMeasurement,
			}),
		);
		previewViewportObservation = observation;

		return () => {
			if (previewViewportObservation === observation) {
				previewViewportObservation = null;
			}
			observation.dispose();
			previewScrollContainer = null;
			previewOwnerWindow = null;
			setPreviewScrollActive(false);
		};
	});

	$effect(() => {
		void geometry;
		void plan.mountedRowEnd;
		if (!contentEl) return;
		flushPreviewRangeFromScroll();
	});

	$effect(() => {
		void rootEl;
		void contentEl;
		void sentinelEl;
		void geometry.rowStride;
		rebuildSentinelObserver();
		return () => {
			sentinelObserver?.disconnect();
		};
	});

	$effect(() => {
		const active = isPreviewSurfaceActive();
		if (active === lastPreviewSurfaceActive) return;
		lastPreviewSurfaceActive = active;
		if (!rootEl || !contentEl) {
			publishPreviewSnapshot(true);
			return;
		}
		measurePreviewViewportGeometry();
		flushPreviewRangeFromScroll();
		syncPreviewHostRows();
		publishCardDemand();
		publishPreviewSnapshot(true);
	});

	onDestroy(() => {
		disposed = true;
		cardHydrator.dispose();
		sentinelObserver?.disconnect();
		frameCoordinator.cancel("post-paint", PREVIEW_WINDOW_COMMIT_TASK_KEY);
		previewSurface.dispose();
	});

	function loadMore(sectionId: string): void {
		const nextSections = sectionProjection.loadMore(sectionId);
		if (nextSections) publishSections(nextSections, "data-revision");
	}

	return {
		get rootEl() {
			return rootEl;
		},
		set rootEl(next: HTMLDivElement | null) {
			rootEl = next;
		},
		get contentEl() {
			return contentEl;
		},
		set contentEl(next: HTMLDivElement | null) {
			contentEl = next;
		},
		get sentinelEl() {
			return sentinelEl;
		},
		set sentinelEl(next: HTMLDivElement | null) {
			sentinelEl = next;
		},
		get layout() {
			return layout;
		},
		get plan() {
			return plan;
		},
		get observerRoot() {
			return rootEl ? findNearestScrollContainer(rootEl) : null;
		},
		get previewSurface() {
			return previewSurface;
		},
		isPreviewHostEnabled(rowIndex: number): boolean {
			return isPreviewControlActive() && previewHostRows.has(rowIndex);
		},
		get interactionDescriptorResolverProvider() {
			return cardHydrator.interactionDescriptorResolverProvider;
		},
		registerCardModelConsumer: cardHydrator.registerConsumer,
		loadNextChunk,
		loadMore,
	};
}
